import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import { canonicalJson } from '../duet/task-spec.js';
import { LOCAL_LIMITS } from './limits.js';
import { createLocalReadTools, LOCAL_READ_TOOL_NAMES } from './read-tools.js';
import type { LocalWorkspaceService } from './workspace-service.js';
import { OAuthFailure, RemoteOAuth, REMOTE_SCOPE } from './remote-oauth.js';

export type RemoteServerOptions = {
  taskId: string;
  workspace: LocalWorkspaceService;
  redirectUri: string;
  authorizeSnapshot(snapshotId: string, iteration?: number): Promise<boolean>;
  onAuthorization(request: {
    id: string;
    clientId: string;
    taskId: string;
    resource: string;
  }): void;
};

/** Separate M5 listener. Before activate(), every request fails closed. */
export class RemoteMcpServer {
  private http: Server | undefined;
  private oauth: RemoteOAuth | undefined;
  private active = 0;
  private budget = 120;
  private budgetWindow = Date.now();
  private terminated = false;
  private sessions = new Set<McpServer>();

  constructor(private readonly options: RemoteServerOptions) {
    // Validate operator configuration before opening any listener.
    new RemoteOAuth({ ...options, origin: 'https://configuration.invalid' }).close();
  }

  async start(): Promise<string> {
    if (this.http || this.terminated) throw new OAuthFailure('server_unavailable', 503);
    const http = createServer({ maxHeaderSize: 8192 }, (request, response) => {
      void this.handle(request, response).catch(() => {
        if (!response.headersSent) json(response, 500, { error: 'remote_internal_error' });
        else response.destroy();
      });
    });
    this.http = http;
    http.requestTimeout = 15_000;
    http.headersTimeout = 10_000;
    http.keepAliveTimeout = 1000;
    http.maxConnections = 32;
    try {
      await new Promise<void>((resolve, reject) => {
        http.once('error', reject);
        http.listen(0, '127.0.0.1', resolve);
      });
      const address = http.address();
      if (!address || typeof address === 'string') throw new Error('Missing listener');
      return `http://127.0.0.1:${address.port}`;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  activate(origin: string): void {
    if (!this.http || this.oauth || this.terminated)
      throw new OAuthFailure('server_unavailable', 503);
    this.oauth = new RemoteOAuth({ ...this.options, origin });
  }

  decide(id: string, approve: boolean): void {
    if (!this.oauth) throw new OAuthFailure('server_unavailable', 503);
    this.oauth.decide(id, approve);
  }

  async close(): Promise<void> {
    this.terminated = true;
    this.oauth?.close();
    const http = this.http;
    this.http = undefined;
    const sessions = [...this.sessions];
    this.sessions.clear();
    const closed =
      http &&
      new Promise<void>((resolve) => {
        http.close(() => resolve());
        http.closeAllConnections();
      });
    await Promise.allSettled(sessions.map((session) => session.close()));
    await closed;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader(
      'content-security-policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    const oauth = this.oauth;
    if (this.terminated || !oauth) return json(response, 503, { error: 'not_ready' });
    // Only configured public authority is accepted. Never trust forwarded headers.
    if (
      request.headers.host !== new URL(oauth.origin).host ||
      (request.headers.origin !== undefined &&
        request.headers.origin !== oauth.origin &&
        request.headers.origin !== 'https://chatgpt.com')
    )
      return json(response, 403, { error: 'origin_denied' });
    if (Date.now() - this.budgetWindow >= 60_000) {
      this.budgetWindow = Date.now();
      this.budget = 120;
    }
    if (this.active >= 8 || --this.budget < 0) {
      response.setHeader('retry-after', '60');
      return json(response, 429, { error: 'temporarily_unavailable' });
    }
    this.active++;
    const timeout = setTimeout(() => response.destroy(), 15_000);
    try {
      if (
        !request.url?.startsWith('/') ||
        request.url.startsWith('//') ||
        request.url.length > 8192
      )
        throw new OAuthFailure('invalid_request');
      const url = new URL(request.url, oauth.origin);
      const method = request.method;
      if (method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server')
        return json(response, 200, oauth.metadata());
      if (
        method === 'GET' &&
        [
          '/.well-known/oauth-protected-resource',
          '/.well-known/oauth-protected-resource/mcp',
        ].includes(url.pathname)
      )
        return json(response, 200, {
          resource: oauth.resource,
          authorization_servers: [oauth.origin],
          scopes_supported: [REMOTE_SCOPE],
        });
      if (method === 'POST' && url.pathname === '/oauth/register') {
        requireType(request, 'application/json');
        return json(response, 201, oauth.register(JSON.parse(await body(request))));
      }
      if (method === 'GET' && url.pathname === '/oauth/authorize') {
        const auth = oauth.authorize(url.searchParams);
        this.options.onAuthorization({
          id: auth.id,
          clientId: auth.clientId,
          taskId: oauth.taskId,
          resource: oauth.resource,
        });
        // This ticket only retrieves the result; it cannot approve the request.
        response.writeHead(303, { location: `/oauth/pending/${auth.ticket}` }).end();
        return;
      }
      if (method === 'GET' && url.pathname.startsWith('/oauth/pending/')) {
        const result = oauth.poll(url.pathname.slice('/oauth/pending/'.length));
        if ('redirect' in result) response.writeHead(303, { location: result.redirect }).end();
        else {
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          response.end(
            `<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>Codex Duet authorization</title><h1>Confirm on your computer</h1><p>Match this request ID in the running Codex Duet terminal:</p><p><code>${result.id}</code></p><p>Only approve a connection you just initiated. This request expires in three minutes.</p></html>`,
          );
        }
        return;
      }
      if (method === 'POST' && url.pathname === '/oauth/token') {
        requireType(request, 'application/x-www-form-urlencoded');
        if (request.headers.authorization) throw new OAuthFailure('invalid_client', 401);
        return json(response, 200, oauth.exchange(new URLSearchParams(await body(request))));
      }
      if (url.pathname !== '/mcp') return json(response, 404, { error: 'not_found' });
      oauth.authenticate(request.headers.authorization);
      if (method !== 'POST') {
        response.setHeader('allow', 'POST');
        return json(response, 405, { error: 'method_not_allowed' });
      }
      requireType(request, 'application/json');
      const input: unknown = JSON.parse(await body(request));
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new OAuthFailure('invalid_request');
      await this.dispatch(request, response, input, oauth);
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const failure = error instanceof OAuthFailure ? error : new OAuthFailure('invalid_request');
      if (failure.code === 'invalid_token')
        response.setHeader(
          'www-authenticate',
          `Bearer resource_metadata="${oauth.origin}/.well-known/oauth-protected-resource", scope="${REMOTE_SCOPE}", error="invalid_token"`,
        );
      json(response, failure.status, { error: failure.code });
    } finally {
      clearTimeout(timeout);
      this.active--;
    }
  }

  private async dispatch(
    request: IncomingMessage,
    response: ServerResponse,
    input: unknown,
    oauth: RemoteOAuth,
  ) {
    const mcp = new McpServer({ name: 'codex-duet-remote', version: '1.0.0' });
    const tools = createLocalReadTools(this.options.workspace);
    for (const name of LOCAL_READ_TOOL_NAMES) {
      const definition = tools[name];
      mcp.registerTool(
        name,
        {
          description: `Read authorized immutable task snapshots via ${name}`,
          inputSchema: definition.inputSchema,
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
          _meta: { securitySchemes: [{ type: 'oauth2', scopes: [REMOTE_SCOPE] }] },
        },
        async (raw: unknown) => {
          try {
            oauth.authenticate(request.headers.authorization);
            const bound = z
              .object({
                taskId: z.literal(oauth.taskId),
                snapshotId: z.string().regex(/^[a-f0-9]{64}$/),
                iteration: z.number().int().positive().optional(),
              })
              .parse(raw);
            if (!(await this.options.authorizeSnapshot(bound.snapshotId, bound.iteration)))
              throw new Error('Denied');
            const value = await definition.invoke(raw);
            oauth.authenticate(request.headers.authorization);
            const output = { content: [{ type: 'text' as const, text: canonicalJson(value) }] };
            if (Buffer.byteLength(canonicalJson(output)) > LOCAL_LIMITS.readResponseBytes)
              throw new Error('Bound');
            return output;
          } catch {
            return {
              isError: true,
              content: [{ type: 'text' as const, text: 'REMOTE_READ_DENIED' }],
            };
          }
        },
      );
    }
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    this.sessions.add(mcp);
    response.once('close', () => {
      this.sessions.delete(mcp);
      void mcp.close().catch(() => undefined);
    });
    try {
      await mcp.connect(transport as Transport);
      await transport.handleRequest(request, response, input);
    } catch (error) {
      this.sessions.delete(mcp);
      await mcp.close();
      throw error;
    }
  }
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
}

function requireType(request: IncomingMessage, expected: string): void {
  if (
    request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== expected ||
    request.headers['content-encoding']
  )
    throw new OAuthFailure('unsupported_media_type', 415);
}

async function body(request: IncomingMessage): Promise<string> {
  const limit = 64 * 1024;
  const declared = request.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit))
    throw new OAuthFailure('request_too_large', 413);
  const chunks: Buffer[] = [];
  let size = 0;
  // Enforce actual bytes as well as declared length, including chunked requests.
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) throw new OAuthFailure('request_too_large', 413);
    chunks.push(bytes);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}
