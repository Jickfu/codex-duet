import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import { ChatbridgeError } from '../core/errors.js';
import type { ResponseIngressService } from '../duet/response-ingress.js';
import { canonicalJson } from '../duet/task-spec.js';
import type { LocalMcpCapabilityStore } from './capability-store.js';
import { LOCAL_LIMITS } from './limits.js';
import { createLocalReadTools, LOCAL_READ_TOOL_NAMES } from './read-tools.js';
import type { LocalWorkspaceService } from './workspace-service.js';

const SubmitResponseSchema = z
  .object({
    capabilityId: z.string().uuid(),
    capability: z.string().min(43).max(128),
    taskId: z.string(),
    iteration: z.number().int().positive(),
    controlSha256: z.string().regex(/^[a-f0-9]{64}$/),
    response: z
      .string()
      .min(1)
      .max(64 * 1024),
  })
  .strict();

export type LocalMcpServerOptions = {
  workspace: LocalWorkspaceService;
  host?: '127.0.0.1' | '::1';
  port?: number;
  submitResponse?: {
    enabled: true;
    capabilities: LocalMcpCapabilityStore;
    ingress: ResponseIngressService;
  };
};

export class LocalMcpServer {
  private http: Server | undefined;

  constructor(private readonly options: LocalMcpServerOptions) {}

  async start(): Promise<{ host: string; port: number; url: string }> {
    if (this.http) throw new ChatbridgeError('Local MCP is already running', 'MCP_ALREADY_RUNNING');
    const host = this.options.host ?? '127.0.0.1';
    this.http = createServer((request, response) => {
      void this.handle(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
        if (!response.writableEnded) response.end('{"error":"LOCAL_MCP_INTERNAL"}');
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.http!.once('error', reject);
      this.http!.listen(this.options.port ?? 0, host, resolve);
    });
    const address = this.http.address();
    if (!address || typeof address === 'string') throw new Error('Local MCP address unavailable');
    return {
      host,
      port: address.port,
      url: `http://${host === '::1' ? '[::1]' : host}:${address.port}/mcp`,
    };
  }

  async close(): Promise<void> {
    const server = this.http;
    this.http = undefined;
    if (!server) return;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  private buildMcp(): McpServer {
    const server = new McpServer({ name: 'codex-duet-local', version: '1.0.0' });
    const tools = createLocalReadTools(this.options.workspace);
    for (const name of LOCAL_READ_TOOL_NAMES) {
      const definition = tools[name];
      server.registerTool(
        name,
        {
          description: `Read immutable LOCAL snapshot data through ${name}`,
          inputSchema: definition.inputSchema,
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
        },
        async (input: unknown) => result(await definition.invoke(input)),
      );
    }
    if (this.options.submitResponse?.enabled) {
      const submission = this.options.submitResponse;
      server.registerTool(
        'submit_response',
        {
          description: 'Submit one task/control-bound C2C response into shared response ingress',
          inputSchema: SubmitResponseSchema,
          annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        },
        async (raw) => {
          const input = SubmitResponseSchema.parse(raw);
          await submission.capabilities.authorize({
            capabilityId: input.capabilityId,
            token: input.capability,
            taskId: input.taskId,
            iteration: input.iteration,
            controlSha256: input.controlSha256,
          });
          await submission.ingress.accept({
            taskId: input.taskId,
            iteration: input.iteration,
            controlSha256: input.controlSha256,
            response: input.response,
            source: 'MCP',
          });
          return result({ accepted: true });
        },
      );
    }
    return server;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (new URL(request.url ?? '/', 'http://localhost').pathname !== '/mcp') {
      response.writeHead(404).end();
      return;
    }
    if (!isLoopbackHost(request.headers.host) || !isAllowedOrigin(request.headers.origin)) {
      response.writeHead(403).end();
      return;
    }
    const rawLength = request.headers['content-length'];
    const length = rawLength === undefined ? undefined : Number(rawLength);
    if (
      request.method === 'POST' &&
      (length === undefined || !Number.isSafeInteger(length) || length <= 0)
    ) {
      response.writeHead(411).end();
      return;
    }
    if (length !== undefined && length > LOCAL_LIMITS.readResponseBytes * 2) {
      response.writeHead(413).end();
      return;
    }
    const mcp = this.buildMcp();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined } as any);
    await mcp.connect(transport as Transport);
    await transport.handleRequest(request, response);
    response.once('close', () => {
      void transport.close();
    });
  }
}

function result(value: unknown) {
  const text = canonicalJson(value);
  const output = { content: [{ type: 'text' as const, text }] };
  if (Buffer.byteLength(canonicalJson(output)) > LOCAL_LIMITS.readResponseBytes)
    throw new ChatbridgeError('MCP response exceeds the bound', 'SNAPSHOT_LIMIT_EXCEEDED');
  return output;
}

function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0];
  return name === '127.0.0.1' || name === 'localhost' || name === '::1';
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const hostname = new URL(origin).hostname;
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
  } catch {
    return false;
  }
}
