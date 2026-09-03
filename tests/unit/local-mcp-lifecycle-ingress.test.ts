import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseEnvelope, serializeEnvelope } from '../../src/core/protocol.js';
import { sha256 } from '../../src/duet/task-spec.js';
import { TaskInteractionPolicyStore } from '../../src/duet/interaction-policy-store.js';
import { CodexBrowserControlStore } from '../../src/duet/codex-browser-control-store.js';
import { LocalLifecycle } from '../../src/local/lifecycle.js';
import { LocalMcpCapabilityStore } from '../../src/local/capability-store.js';
import { LocalMcpLifecycleIngress } from '../../src/local/mcp-lifecycle-ingress.js';
import { localSpec } from '../fixtures/local-task-spec.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mcp-lifecycle-'));
  const spec = localSpec();
  const policy = {
    version: 1 as const,
    taskId: 'demo',
    browserControlProvider: 'CODEX_BROWSER' as const,
    discussion: { enabled: false },
    selectedAt: new Date(0).toISOString(),
  };
  await new TaskInteractionPolicyStore(root).createOrVerify(policy);
  const snapshots = { capture: vi.fn(), assertLiveSnapshot: vi.fn(async () => {}) };
  const provider = { status: async () => ({ context: spec.context, reviews: [] }) } as never;
  // Setup gates are fixtures; the adapter below uses real stored send/policy/capability checks.
  const lifecycle = new LocalLifecycle(root, provider, snapshots, {
    assertPlanningReady: async () => {},
    assertControlConfirmed: async () => {},
    assertResponseReceived: async () => {},
  });
  const run = await lifecycle.init(spec, policy);
  await lifecycle.confirmControl('demo');
  const control = parseEnvelope(run.control);
  const request = {
    taskId: 'demo',
    iteration: 1,
    controlSha256: sha256(run.control),
    source: 'MCP' as const,
    response: serializeEnvelope({
      ...control,
      state: 'PLAN',
      content: JSON.stringify({
        identity: JSON.parse(control.content).identity,
        result: 'fixture plan',
      }),
    }),
  };
  const store = new CodexBrowserControlStore(root);
  const record = {
    version: 1 as const,
    taskId: 'demo',
    provider: 'CODEX_BROWSER' as const,
    conversationUrl: 'https://chatgpt.com/c/fixture',
    operation: {
      operationId: sha256(
        JSON.stringify({
          taskId: 'demo',
          kind: 'PLANNER',
          iteration: 1,
          outboundSha256: request.controlSha256,
        }),
      ),
      kind: 'PLANNER' as const,
      iteration: 1,
      outboundSha256: request.controlSha256,
      state: 'CONFIRMED' as const,
      preparedAt: new Date(0).toISOString(),
      completedAt: new Date(0).toISOString(),
    },
  };
  await store.write(record);
  const capabilities = new LocalMcpCapabilityStore(root);
  const credential = await capabilities.issue({
    taskId: 'demo',
    iteration: 1,
    controlSha256: request.controlSha256,
  });
  const adapter = () => new LocalMcpLifecycleIngress(root, provider, snapshots, capabilities);
  return {
    root,
    lifecycle,
    snapshots,
    request,
    store,
    record,
    capabilities,
    credential,
    adapter,
    receiptFile: path.join(root, 'runs', 'demo', 'ingress', '1', request.controlSha256 + '.json'),
  };
}

describe('authenticated LOCAL MCP lifecycle ingress', () => {
  it('authenticates even historical replay and never needs a fabricated Browser response', async () => {
    const f = await fixture();
    expect((await f.adapter().accept(f.request, f.credential)).disposition).toBe('ACCEPTED');
    expect((await f.lifecycle.status('demo')).state).toBe('PLAN');
    expect((await f.store.read('demo'))?.operation.state).toBe('CONFIRMED');
    expect((await f.adapter().accept(f.request, f.credential)).disposition).toBe('REPLAY');
    await expect(
      f.adapter().accept(f.request, { ...f.credential, token: 'x'.repeat(43) }),
    ).rejects.toThrow();
    await expect(
      f.adapter().accept({ ...f.request, response: f.request.response + ' ' }, f.credential),
    ).rejects.toMatchObject({ code: 'RESPONSE_ALREADY_ACCEPTED' });
    expect((await f.lifecycle.ingest({ ...f.request, source: 'BROWSER' })).disposition).toBe(
      'REPLAY',
    );
    expect(await readFile(f.receiptFile, 'utf8')).not.toContain(f.credential.token);
  });

  it.each(['PREPARED', 'ATTEMPTED', 'OUTCOME_UNKNOWN'] as const)(
    'does not use capability possession to bypass %s transport state',
    async (state) => {
      const f = await fixture();
      await f.store.write({ ...f.record, operation: { ...f.record.operation, state } });
      await expect(f.adapter().accept(f.request, f.credential)).rejects.toMatchObject({
        code: 'CODEX_BROWSER_SEND_NOT_CONFIRMED',
      });
      await expect(readFile(f.receiptFile)).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('rejects foreign bindings, source confusion, cancellation and live drift before reservation', async () => {
    const f = await fixture();
    for (const request of [
      { ...f.request, taskId: 'other' },
      { ...f.request, iteration: 2 },
      { ...f.request, controlSha256: 'f'.repeat(64) },
      { ...f.request, source: 'BROWSER' as const },
    ])
      await expect(f.adapter().accept(request, f.credential)).rejects.toThrow();
    f.snapshots.assertLiveSnapshot.mockRejectedValueOnce(new Error('drift'));
    await expect(f.adapter().accept(f.request, f.credential)).rejects.toThrow('drift');
    await f.lifecycle.cancel('demo', 'stop');
    await expect(f.adapter().accept(f.request, f.credential)).rejects.toThrow();
    await expect(readFile(f.receiptFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reauthenticates under the shared lock and does not accept a failed pending application', async () => {
    const f = await fixture();
    const authorize = f.capabilities.authorize.bind(f.capabilities);
    let calls = 0;
    vi.spyOn(f.capabilities, 'authorize').mockImplementation(async (request) => {
      if (++calls === 3) throw new Error('capability changed before apply');
      return authorize(request);
    });
    await expect(f.adapter().accept(f.request, f.credential)).rejects.toThrow('capability changed');
    expect((await f.lifecycle.status('demo')).state).toBe('PLANNING');
    expect(JSON.parse(await readFile(f.receiptFile, 'utf8')).status).toBe('PENDING');
    expect((await f.adapter().accept(f.request, f.credential)).disposition).toBe('ACCEPTED');
  });

  it('preserves a Browser-first winner without allowing a divergent MCP reply', async () => {
    const f = await fixture();
    await f.lifecycle.ingest({ ...f.request, source: 'BROWSER' });
    expect((await f.adapter().accept(f.request, f.credential)).disposition).toBe('REPLAY');
    await expect(
      f.adapter().accept({ ...f.request, response: f.request.response + ' ' }, f.credential),
    ).rejects.toThrow();
    expect(JSON.parse(await readFile(f.receiptFile, 'utf8')).source).toBe('BROWSER');
  });
});
