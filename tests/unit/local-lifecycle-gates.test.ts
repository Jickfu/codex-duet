import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { StoredLocalLifecycleGates } from '../../src/local/lifecycle-gates.js';
import { TaskInteractionPolicyStore } from '../../src/duet/interaction-policy-store.js';
import { CodexBrowserControlStore } from '../../src/duet/codex-browser-control-store.js';
import { sha256 } from '../../src/duet/task-spec.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-gates-'));
  const policy = {
    version: 1 as const,
    taskId: 'demo',
    browserControlProvider: 'CODEX_BROWSER' as const,
    discussion: { enabled: false },
    selectedAt: new Date(0).toISOString(),
  };
  const policies = new TaskInteractionPolicyStore(root);
  await policies.createOrVerify(policy);
  const store = new CodexBrowserControlStore(root);
  const identity = { kind: 'PLANNER' as const, iteration: 1 };
  const hash = sha256('control');
  const record = {
    version: 1 as const,
    taskId: 'demo',
    provider: 'CODEX_BROWSER' as const,
    conversationUrl: 'https://chatgpt.com/c/fixture',
    operation: {
      operationId: sha256(JSON.stringify({ taskId: 'demo', ...identity, outboundSha256: hash })),
      ...identity,
      outboundSha256: hash,
      state: 'CONFIRMED' as const,
      preparedAt: new Date(0).toISOString(),
      completedAt: new Date(0).toISOString(),
    },
  };
  return {
    root,
    policy,
    policies,
    store,
    identity,
    hash,
    record,
    gates: new StoredLocalLifecycleGates(root),
  };
}
describe('stored LOCAL lifecycle gates', () => {
  it.each(['PREPARED', 'ATTEMPTED', 'OUTCOME_UNKNOWN'] as const)(
    'rejects %s as send confirmation',
    async (state) => {
      const f = await fixture();
      await f.store.write({ ...f.record, operation: { ...f.record.operation, state } });
      await expect(
        f.gates.assertControlConfirmed('demo', f.hash, f.policy, f.identity),
      ).rejects.toMatchObject({ code: 'CODEX_BROWSER_SEND_NOT_CONFIRMED' });
    },
  );
  it('requires exact digest, role, iteration, operation identity and stable conversation', async () => {
    const f = await fixture();
    await f.store.write(f.record);
    await f.gates.assertControlConfirmed('demo', f.hash, f.policy, f.identity);
    await expect(
      f.gates.assertControlConfirmed('demo', sha256('other'), f.policy, f.identity),
    ).rejects.toThrow();
    await expect(
      f.gates.assertControlConfirmed('demo', f.hash, f.policy, { kind: 'REVIEWER', iteration: 1 }),
    ).rejects.toThrow();
    await expect(
      f.gates.assertControlConfirmed('demo', f.hash, f.policy, { kind: 'PLANNER', iteration: 2 }),
    ).rejects.toThrow();
    await f.store.write({ ...f.record, conversationUrl: 'https://chatgpt.com/' });
    await expect(
      f.gates.assertControlConfirmed('demo', f.hash, f.policy, f.identity),
    ).rejects.toThrow();
  });
  it('requires exact durable inbound bytes and refuses unconfigured MCP ingress', async () => {
    const f = await fixture();
    const response =
      '[C2C/1]\nTASK: demo\nITERATION: 1\nSTATE: PLAN\nMODE: LOCAL\n\nPLAN:\nexact fixture response';
    const request = {
      taskId: 'demo',
      iteration: 1,
      controlSha256: f.hash,
      source: 'BROWSER' as const,
      response,
    };
    await f.store.write(f.record);
    await expect(f.gates.assertResponseReceived(request, f.policy)).rejects.toThrow();
    await f.store.write({
      ...f.record,
      operation: { ...f.record.operation, state: 'RESPONDED', inboundSha256: sha256(response) },
    });
    await expect(f.gates.assertResponseReceived(request, f.policy)).rejects.toThrow();
    await f.store.createResponseArtifact('demo', f.record.operation.operationId, response);
    await f.gates.assertResponseReceived(request, f.policy);
    await expect(
      f.gates.assertResponseReceived({ ...request, response: response + '\n' }, f.policy),
    ).rejects.toThrow();
    await expect(
      f.gates.assertResponseReceived({ ...request, source: 'MCP' }, f.policy),
    ).rejects.toMatchObject({ code: 'LOCAL_MCP_INGRESS_NOT_CONFIGURED' });
  });
  it('does not infer Playwright confirmation from a legacy marker', async () => {
    const f = await fixture();
    const policy = { ...f.policy, browserControlProvider: 'PLAYWRIGHT_CLI' as const };
    await f.policies.setBeforeLock(policy);
    await expect(
      f.gates.assertControlConfirmed('demo', f.hash, policy, f.identity),
    ).rejects.toMatchObject({ code: 'LOCAL_TRANSPORT_PROOF_UNAVAILABLE' });
  });
});
