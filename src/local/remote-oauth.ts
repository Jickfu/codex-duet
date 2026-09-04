import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { TaskIdSchema } from '../core/domain.js';

export const REMOTE_SCOPE = 'snapshots:read';
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const digest = (value: string) => createHash('sha256').update(value).digest('base64url');
const secret = () => randomBytes(32).toString('base64url');

export class OAuthFailure extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}

type Authorization = {
  id: string;
  clientId: string;
  state: string;
  challenge: string;
  expires: number;
  decision: 'PENDING' | 'APPROVED' | 'DENIED';
};
type Code = { clientId: string; challenge: string; expires: number };

/** Ephemeral single-operator authorization; only the local owner calls decide(). */
export class RemoteOAuth {
  readonly taskId: string;
  readonly origin: string;
  readonly resource: string;
  readonly redirectUri: string;
  private clients = new Set<string>();
  private pending = new Map<string, Authorization>();
  private codes = new Map<string, Code>();
  private tokens = new Map<string, number>();
  private closed = false;

  constructor(
    options: { origin: string; taskId: string; redirectUri: string },
    private readonly now: () => number = Date.now,
  ) {
    const origin = new URL(options.origin);
    if (origin.protocol !== 'https:' || origin.origin !== options.origin)
      throw new OAuthFailure('invalid_resource');
    const redirect = new URL(options.redirectUri);
    if (
      redirect.origin !== 'https://chatgpt.com' ||
      redirect.href !== options.redirectUri ||
      redirect.search ||
      redirect.hash ||
      redirect.username ||
      redirect.password ||
      !/^\/(connector_platform_oauth_redirect|connector\/oauth\/[A-Za-z0-9_-]+)$/.test(
        redirect.pathname,
      )
    )
      throw new OAuthFailure('invalid_redirect_uri');
    this.origin = options.origin;
    this.resource = `${this.origin}/mcp`;
    this.redirectUri = options.redirectUri;
    this.taskId = TaskIdSchema.parse(options.taskId);
  }

  metadata() {
    return {
      issuer: this.origin,
      authorization_endpoint: `${this.origin}/oauth/authorize`,
      token_endpoint: `${this.origin}/oauth/token`,
      registration_endpoint: `${this.origin}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: [REMOTE_SCOPE],
      authorization_response_iss_parameter_supported: true,
    };
  }

  register(raw: unknown) {
    this.prune();
    const input = z
      .object({
        redirect_uris: z.array(z.literal(this.redirectUri)).length(1),
        token_endpoint_auth_method: z.literal('none'),
        grant_types: z.array(z.literal('authorization_code')).length(1).optional(),
        response_types: z.array(z.literal('code')).length(1).optional(),
        client_name: z.string().max(128).optional(),
      })
      .parse(raw);
    if (this.clients.size >= 32) throw new OAuthFailure('temporarily_unavailable', 429);
    const clientId = randomUUID();
    this.clients.add(clientId);
    return {
      client_id: clientId,
      redirect_uris: input.redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    };
  }

  authorize(params: URLSearchParams) {
    this.prune();
    const p = uniqueParams(params);
    if (
      p.response_type !== 'code' ||
      !this.clients.has(p.client_id ?? '') ||
      p.redirect_uri !== this.redirectUri ||
      p.resource !== this.resource ||
      p.scope !== REMOTE_SCOPE ||
      p.code_challenge_method !== 'S256' ||
      !SECRET.test(p.code_challenge ?? '') ||
      !p.state ||
      p.state.length > 1024
    )
      throw new OAuthFailure('invalid_request');
    if (this.pending.size >= 8) throw new OAuthFailure('temporarily_unavailable', 429);
    const ticket = secret();
    const request: Authorization = {
      id: randomUUID(),
      clientId: p.client_id!,
      state: p.state,
      challenge: p.code_challenge!,
      expires: this.now() + 180_000,
      decision: 'PENDING',
    };
    this.pending.set(digest(ticket), request);
    return { ticket, id: request.id, clientId: request.clientId };
  }

  decide(id: string, approve: boolean): void {
    this.prune();
    const request = [...this.pending.values()].find((value) => value.id === id);
    if (!request || request.decision !== 'PENDING') throw new OAuthFailure('invalid_request');
    request.decision = approve ? 'APPROVED' : 'DENIED';
  }

  poll(ticket: string): { id: string } | { redirect: string } {
    this.prune();
    if (!SECRET.test(ticket)) throw new OAuthFailure('invalid_request');
    const request = this.pending.get(digest(ticket));
    if (!request) throw new OAuthFailure('invalid_request');
    if (request.decision === 'PENDING') return { id: request.id };
    if (this.codes.size >= 32) throw new OAuthFailure('temporarily_unavailable', 429);
    this.pending.delete(digest(ticket));
    const callback = new URL(this.redirectUri);
    callback.searchParams.set('state', request.state);
    callback.searchParams.set('iss', this.origin);
    if (request.decision === 'DENIED') callback.searchParams.set('error', 'access_denied');
    else {
      const code = secret();
      this.codes.set(digest(code), {
        clientId: request.clientId,
        challenge: request.challenge,
        expires: this.now() + 60_000,
      });
      callback.searchParams.set('code', code);
    }
    return { redirect: callback.href };
  }

  exchange(params: URLSearchParams) {
    this.prune();
    const p = uniqueParams(params);
    if (p.grant_type !== 'authorization_code') throw new OAuthFailure('unsupported_grant_type');
    if (!SECRET.test(p.code ?? '')) throw new OAuthFailure('invalid_grant');
    const key = digest(p.code!);
    const code = this.codes.get(key);
    // A presented code is consumed even on a failed exchange.
    this.codes.delete(key);
    if (
      !code ||
      p.client_id !== code.clientId ||
      p.redirect_uri !== this.redirectUri ||
      p.resource !== this.resource ||
      !VERIFIER.test(p.code_verifier ?? '') ||
      digest(p.code_verifier!) !== code.challenge
    )
      throw new OAuthFailure('invalid_grant');
    if (this.tokens.size >= 32) throw new OAuthFailure('temporarily_unavailable', 429);
    const token = secret();
    this.tokens.set(digest(token), this.now() + 3_600_000);
    return { access_token: token, token_type: 'Bearer', expires_in: 3600, scope: REMOTE_SCOPE };
  }

  authenticate(header: string | undefined): void {
    this.prune();
    const token = header?.match(/^Bearer ([A-Za-z0-9_-]{43})$/i)?.[1];
    if (!token || !this.tokens.has(digest(token))) throw new OAuthFailure('invalid_token', 401);
  }

  close(): void {
    this.closed = true;
    this.clients.clear();
    this.pending.clear();
    this.codes.clear();
    this.tokens.clear();
  }

  private prune(): void {
    if (this.closed) throw new OAuthFailure('temporarily_unavailable', 503);
    const now = this.now();
    for (const [key, value] of this.pending) if (value.expires <= now) this.pending.delete(key);
    for (const [key, value] of this.codes) if (value.expires <= now) this.codes.delete(key);
    for (const [key, expires] of this.tokens) if (expires <= now) this.tokens.delete(key);
  }
}

export function uniqueParams(params: URLSearchParams): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const [key, value] of params) {
    if (Object.hasOwn(result, key)) throw new OAuthFailure('invalid_request');
    result[key] = value;
  }
  return result;
}
