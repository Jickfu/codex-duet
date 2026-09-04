import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteMcpServer } from '../../src/local/remote-server.js';

const origin = 'https://test.trycloudflare.com';
const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';
const snapshotId = 'a'.repeat(64);
const servers: RemoteMcpServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function setup() {
  const diagnostic = vi.fn();
  const workspaceInfo = vi.fn(async (input) => input);
  let pending = '';
  const server = new RemoteMcpServer({
    taskId: 'demo',
    onDiagnostic: diagnostic,
    redirectUri,
    workspace: { workspaceInfo } as never,
    authorizeSnapshot: async (id) => id === snapshotId,
    onAuthorization: ({ id }) => {
      pending = id;
    },
  });
  servers.push(server);
  const listener = await server.start();
  const send = (
    route: string,
    method = 'GET',
    payload = '',
    headers: Record<string, string> = {},
    chunked = false,
  ) =>
    new Promise<{ status: number; headers: any; text: string }>((resolve, reject) => {
      const req = request(
        `${listener}${route}`,
        { method, headers: { host: new URL(origin).host, ...headers } },
        (res) => {
          let text = '';
          res.on('data', (chunk) => {
            text += chunk;
          });
          res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, text }));
        },
      );
      req.on('error', reject);
      if (chunked) {
        req.write(payload.slice(0, 100));
        req.end(payload.slice(100));
      } else req.end(payload);
    });
  const token = async () => {
    const registered = await send(
      '/oauth/register',
      'POST',
      JSON.stringify({ redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' }),
      { 'content-type': 'application/json' },
    );
    expect(registered.status).toBe(201);
    const clientId = JSON.parse(registered.text).client_id;
    const verifier = 'v'.repeat(43);
    const auth = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'snapshots:read',
      resource: `${origin}/mcp`,
      state: 'test',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    const authorized = await send(`/oauth/authorize?${auth}`);
    expect(authorized.status).toBe(303);
    const wait = await send(authorized.headers.location);
    expect(wait.text).toContain(pending);
    expect(wait.headers['cache-control']).toBe('no-store');
    server.decide(pending, true);
    const redirect = await send(authorized.headers.location);
    expect(redirect.status).toBe(303);
    const callback = new URL(redirect.headers.location);
    const exchange = await send(
      '/oauth/token',
      'POST',
      new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        resource: `${origin}/mcp`,
        grant_type: 'authorization_code',
        code: callback.searchParams.get('code')!,
        code_verifier: verifier,
      }).toString(),
      { 'content-type': 'application/x-www-form-urlencoded' },
    );
    expect(exchange.status).toBe(200);
    return JSON.parse(exchange.text).access_token as string;
  };
  return { server, send, token, workspaceInfo, diagnostic };
}

describe('authenticated JSON MCP boundary', () => {
  it('reports bounded diagnostics without request secrets and tolerates callback failures', async () => {
    const { server, send, diagnostic } = await setup();
    server.activate(origin);
    await send('/oauth/register?secret=private', 'POST', '{"client_secret":"private"}', {
      'content-type': 'application/json',
      authorization: 'Bearer private',
    });
    await send('/private-path?code=private');
    expect(diagnostic.mock.calls).toEqual([
      [
        {
          endpoint: 'register',
          status: 400,
          invalidFields: ['redirect_uris', 'token_endpoint_auth_method'],
        },
      ],
      [{ endpoint: 'other', status: 404 }],
    ]);
    diagnostic.mockImplementation(() => {
      throw new Error('observer failure');
    });
    expect((await send('/.well-known/oauth-authorization-server')).status).toBe(200);
  });

  it('fails closed until pinned, challenges before data, and ignores forwarded authority', async () => {
    const { server, send, workspaceInfo } = await setup();
    expect((await send('/mcp')).status).toBe(503);
    server.activate(origin);
    const unauthorized = await send('/mcp');
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers['www-authenticate']).toContain(
      `${origin}/.well-known/oauth-protected-resource`,
    );
    expect(
      (
        await send('/mcp', 'GET', '', {
          host: 'evil.test',
          'x-forwarded-host': new URL(origin).host,
        })
      ).status,
    ).toBe(403);
    expect((await send('/mcp', 'GET', '', { origin: 'null' })).status).toBe(403);
    expect(workspaceInfo).not.toHaveBeenCalled();
    expect(
      JSON.parse((await send('/.well-known/oauth-protected-resource/mcp')).text).resource,
    ).toBe(`${origin}/mcp`);
    expect(() => server.activate('https://different.trycloudflare.com')).toThrow();
    expect((await send('/oauth/approve', 'POST')).status).toBe(404);
  });

  it('completes OAuth and MCP initialize/list/read without SSE; denies cross-task and unpublished snapshots', async () => {
    const { server, send, token, workspaceInfo } = await setup();
    server.activate(origin);
    const bearer = await token();
    const headers = {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    const rpc = (method: string, params: unknown) =>
      send('/mcp', 'POST', JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), headers);
    const initialized = await rpc('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    expect(initialized.status).toBe(200);
    expect(initialized.headers['content-type']).toContain('application/json');
    const tools = JSON.parse((await rpc('tools/list', {})).text).result.tools;
    expect(tools).toHaveLength(8);
    expect(tools.map((tool: any) => tool.name)).not.toContain('submit_response');
    const read = async (taskId: string, id: string) =>
      JSON.parse(
        (await rpc('tools/call', { name: 'workspace_info', arguments: { taskId, snapshotId: id } }))
          .text,
      ).result;
    expect((await read('demo', snapshotId)).isError).not.toBe(true);
    expect((await read('other', snapshotId)).isError).toBe(true);
    expect((await read('demo', 'b'.repeat(64))).isError).toBe(true);
    expect(workspaceInfo).toHaveBeenCalledOnce();
    expect((await send('/mcp', 'GET', '', headers)).status).toBe(405);
    expect(
      (await send('/mcp', 'POST', '{}', { ...headers, authorization: 'Bearer invalid' })).status,
    ).toBe(401);
  });

  it('bounds chunked bodies and does not publish exception contents', async () => {
    const { server, send, token, workspaceInfo } = await setup();
    server.activate(origin);
    const bearer = await token();
    workspaceInfo.mockRejectedValue(new Error('private local path and secret'));
    const headers = {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    const result = await send(
      '/mcp',
      'POST',
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'workspace_info', arguments: { taskId: 'demo', snapshotId } },
      }),
      headers,
      true,
    );
    expect(result.text).toContain('REMOTE_READ_DENIED');
    expect(result.text).not.toContain('private');
    const oversized = await send(
      '/oauth/register',
      'POST',
      'x'.repeat(70 * 1024),
      { 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
      true,
    ).catch(() => ({ status: 0 }));
    // A destroyed oversized stream or an explicit 413 are both fail-closed.
    expect([0, 413]).toContain(oversized.status);
  });
});
