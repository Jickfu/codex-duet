import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RemoteOAuth } from '../../src/local/remote-oauth.js';

const origin = 'https://test.trycloudflare.com';
const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';
const verifier = 'v'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');

function setup() {
  let now = 0;
  const oauth = new RemoteOAuth({ origin, redirectUri, taskId: 'demo' }, () => now);
  const client = oauth.register({
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: 'none',
  });
  const params = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'snapshots:read',
    resource: `${origin}/mcp`,
    state: 'client-state',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  const authorize = () => oauth.authorize(params);
  const approvedCode = () => {
    const pending = authorize();
    oauth.decide(pending.id, true);
    const result = oauth.poll(pending.ticket);
    if (!('redirect' in result)) throw new Error('Missing callback');
    const callback = new URL(result.redirect);
    expect(callback.origin + callback.pathname).toBe(redirectUri);
    expect(callback.searchParams.get('iss')).toBe(origin);
    expect(callback.searchParams.get('state')).toBe('client-state');
    return new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: client.client_id,
      redirect_uri: redirectUri,
      resource: `${origin}/mcp`,
      code_verifier: verifier,
      code: callback.searchParams.get('code')!,
    });
  };
  return {
    oauth,
    params,
    authorize,
    approvedCode,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('ephemeral operator OAuth', () => {
  it('negotiates code-only registration without granting refresh-token access', () => {
    const { oauth } = setup();
    const metadata = { redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' };
    const client = oauth.register({
      ...metadata,
      grant_types: ['authorization_code', 'refresh_token'],
    });
    expect(client.grant_types).toEqual(['authorization_code']);
    expect(oauth.metadata().grant_types_supported).toEqual(['authorization_code']);
    expect(() =>
      oauth.exchange(
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: client.client_id,
          refresh_token: 'unused',
        }),
      ),
    ).toThrow();
    for (const grant_types of [
      ['refresh_token'],
      ['client_credentials'],
      ['authorization_code', 'authorization_code'],
    ]) {
      expect(() => oauth.register({ ...metadata, grant_types })).toThrow();
    }
  });

  it('requires local approval, delivers one code once, and never grants by public request id', () => {
    const { oauth, authorize } = setup();
    const pending = authorize();
    expect(oauth.poll(pending.ticket)).toEqual({ id: pending.id });
    expect(() => oauth.poll(pending.id)).toThrow();
    oauth.decide(pending.id, true);
    expect(oauth.poll(pending.ticket)).toHaveProperty('redirect');
    expect(() => oauth.poll(pending.ticket)).toThrow();
    expect(() => oauth.decide(pending.id, true)).toThrow();
  });

  it('issues expiring opaque tokens bound to one lifetime, not a client-provided audience', () => {
    const { oauth, approvedCode, advance } = setup();
    const params = approvedCode();
    const token = oauth.exchange(params);
    expect(token).not.toHaveProperty('refresh_token');
    expect(() => oauth.exchange(params)).toThrow('invalid_grant');
    oauth.authenticate(`Bearer ${token.access_token}`);
    expect(() => setup().oauth.authenticate(`Bearer ${token.access_token}`)).toThrow(
      'invalid_token',
    );
    advance(3_600_000);
    expect(() => oauth.authenticate(`Bearer ${token.access_token}`)).toThrow('invalid_token');
  });

  it.each([
    ['resource', 'https://other.example/mcp'],
    ['redirect_uri', 'https://attacker.example/'],
    ['scope', 'snapshots:read write'],
    ['code_challenge_method', 'plain'],
    ['code_challenge', 'short'],
    ['client_id', 'unknown'],
    ['response_type', 'token'],
  ])('rejects authorization substitution of %s', (key, value) => {
    const { oauth, params } = setup();
    params.set(key, value);
    expect(() => oauth.authorize(params)).toThrow('invalid_request');
  });

  it.each([
    ['resource', 'https://other.example/mcp'],
    ['redirect_uri', `${redirectUri}?extra=1`],
    ['client_id', 'another-client'],
    ['code_verifier', 'x'.repeat(43)],
  ])('consumes a code on invalid %s exchange and refuses replay', (key, value) => {
    const { oauth, approvedCode } = setup();
    const params = approvedCode();
    const changed = new URLSearchParams(params);
    changed.set(key, value);
    expect(() => oauth.exchange(changed)).toThrow('invalid_grant');
    expect(() => oauth.exchange(params)).toThrow('invalid_grant');
  });

  it('expires pending requests and codes; close invalidates active tokens', () => {
    const { oauth, authorize, approvedCode, advance } = setup();
    const code = approvedCode();
    advance(60_000);
    expect(() => oauth.exchange(code)).toThrow('invalid_grant');
    const pending = authorize();
    advance(180_000);
    expect(() => oauth.decide(pending.id, true)).toThrow();
    expect(() => oauth.poll(pending.ticket)).toThrow();
    const token = oauth.exchange(approvedCode());
    oauth.close();
    expect(() => oauth.authenticate(`Bearer ${token.access_token}`)).toThrow();
    expect(() => oauth.register({})).toThrow();
  });

  it('returns issuer and state on denial without issuing a code', () => {
    const { oauth, authorize } = setup();
    const pending = authorize();
    oauth.decide(pending.id, false);
    const result = oauth.poll(pending.ticket);
    expect(result).toHaveProperty('redirect');
    const callback = new URL((result as { redirect: string }).redirect);
    expect(callback.searchParams.get('error')).toBe('access_denied');
    expect(callback.searchParams.get('iss')).toBe(origin);
    expect(callback.searchParams.has('code')).toBe(false);
  });

  it('bounds pending authorization and rejects duplicated OAuth parameters', () => {
    const { oauth, params, authorize } = setup();
    params.append('resource', `${origin}/mcp`);
    expect(authorize).toThrow('invalid_request');
    params.delete('resource');
    params.set('resource', `${origin}/mcp`);
    for (let index = 0; index < 8; index++) authorize();
    expect(authorize).toThrow('temporarily_unavailable');
    expect(() =>
      oauth.register({
        redirect_uris: ['https://attacker.example'],
        token_endpoint_auth_method: 'none',
      }),
    ).toThrow();
  });

  it.each([
    'http://chatgpt.com/connector_platform_oauth_redirect',
    'https://chatgpt.com.evil/connector_platform_oauth_redirect',
    `${redirectUri}?next=evil`,
    `${redirectUri}#fragment`,
    'https://user:pass@chatgpt.com/connector_platform_oauth_redirect',
  ])('rejects unsafe operator callback %s', (uri) => {
    expect(() => new RemoteOAuth({ origin, redirectUri: uri, taskId: 'demo' })).toThrow();
  });
});
