import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalMcpServer } from '../../src/local/mcp-server.js';
import { LocalMcpCapabilityStore } from '../../src/local/capability-store.js';
import { ResponseIngressService } from '../../src/duet/response-ingress.js';
import { LOCAL_LIMITS } from '../../src/local/limits.js';

const fakeWorkspace = {
  workspaceInfo: vi.fn(async (input) => ({ ...input, snapshot: { version: 1 } })),
  listDirectory: vi.fn(),
  readFile: vi.fn(),
  searchWorkspace: vi.fn(),
  gitStatus: vi.fn(),
  gitDiff: vi.fn(),
  testStatus: vi.fn(),
  executionSummary: vi.fn(),
};

describe('LocalMcpServer', () => {
  it('rejects runtime non-loopback listen addresses', async () => {
    const denied = new LocalMcpServer({
      workspace: fakeWorkspace as never,
      host: '0.0.0.0' as never,
    });
    await expect(denied.start()).rejects.toMatchObject({ code: 'LOCAL_MCP_HOST_DENIED' });
  });
  let server: LocalMcpServer | undefined;
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    await server?.close();
  });

  it('binds a real localhost MCP and exposes exactly eight read tools by default', async () => {
    server = new LocalMcpServer({ workspace: fakeWorkspace as never });
    const address = await server.start();
    expect(address.host).toBe('127.0.0.1');
    client = new Client({ name: 'test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(address.url)) as Transport);
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
      'execution_summary',
      'git_diff',
      'git_status',
      'list_directory',
      'read_file',
      'search_workspace',
      'test_status',
      'workspace_info',
    ]);
    await expect(
      client.callTool({
        name: 'workspace_info',
        arguments: { taskId: 'demo', snapshotId: 'a'.repeat(64) },
      }),
    ).resolves.toMatchObject({
      content: [{ type: 'text', text: expect.stringContaining('"taskId":"demo"') }],
    });
  });

  it('exposes submit_response only when enabled and enforces the exact capability binding', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'duet-mcp-'));
    const capabilities = new LocalMcpCapabilityStore(root);
    const apply = vi.fn(async () => undefined);
    const ingress = new ResponseIngressService(root, apply);
    const controlSha256 = 'b'.repeat(64);
    const issued = await capabilities.issue({ taskId: 'demo', iteration: 1, controlSha256 });
    server = new LocalMcpServer({
      workspace: fakeWorkspace as never,
      submitResponse: { enabled: true, capabilities, ingress },
    });
    const address = await server.start();
    client = new Client({ name: 'test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(address.url)) as Transport);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('submit_response');
    await client.callTool({
      name: 'submit_response',
      arguments: {
        capabilityId: issued.capabilityId,
        capability: issued.token,
        taskId: 'demo',
        iteration: 1,
        controlSha256,
        response: 'C2C response',
      },
    });
    expect(apply).toHaveBeenCalledOnce();
  });

  it('rejects non-loopback Host headers before MCP handling', async () => {
    server = new LocalMcpServer({ workspace: fakeWorkspace as never });
    const address = await server.start();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        address.url,
        { headers: { host: 'attacker.example' } },
        (response) => resolve(response.statusCode),
      );
      request.once('error', reject);
      request.end();
    });
    expect(status).toBe(403);
  });

  it('rejects oversized chunked requests without buffering their body', async () => {
    server = new LocalMcpServer({ workspace: fakeWorkspace as never });
    const address = await server.start();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        address.url,
        { method: 'POST', headers: { 'transfer-encoding': 'chunked' } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.once('error', reject);
      request.end('x'.repeat(LOCAL_LIMITS.readResponseBytes * 3));
    });
    expect(status).toBe(411);
  });

  it('bounds the complete tool result including JSON escaping and wrapper overhead', async () => {
    server = new LocalMcpServer({
      workspace: {
        ...fakeWorkspace,
        readFile: async () => ({ content: '"'.repeat(LOCAL_LIMITS.readResponseBytes / 2 - 100) }),
      } as never,
    });
    const address = await server.start();
    client = new Client({ name: 'test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(address.url)) as Transport);
    const result = await client.callTool({
      name: 'read_file',
      arguments: { taskId: 'demo', snapshotId: 'a'.repeat(64), path: 'file.txt' },
    });
    expect(result.isError).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(LOCAL_LIMITS.readResponseBytes);
  });

  it('returns a usable bracketed IPv6 localhost endpoint', async () => {
    server = new LocalMcpServer({ workspace: fakeWorkspace as never, host: '::1' });
    const address = await server.start();
    expect(new URL(address.url).hostname).toBe('[::1]');
    client = new Client({ name: 'test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(address.url)) as Transport);
    expect((await client.listTools()).tools).toHaveLength(8);
  });
});
