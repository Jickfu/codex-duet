import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserAutomationSession } from '../../src/browser/browser-automation-session.js';
import { TaskBrowserStore } from '../../src/browser/task-browser-store.js';
import { TaskInteractionPolicyStore } from '../../src/duet/interaction-policy-store.js';
import { sha256 } from '../../src/duet/task-spec.js';
import {
  LocalPlaywrightTransport,
  type LocalOutbound,
} from '../../src/local/playwright-transport.js';
import { LocalPlaywrightProofStore } from '../../src/local/playwright-proof.js';
import { StoredLocalLifecycleGates } from '../../src/local/lifecycle-gates.js';

afterEach(() => vi.restoreAllMocks());
const url = 'https://chatgpt.com/c/local-fixture';
const raw = '[C2C/1]\nTASK: demo\nITERATION: 1\nSTATE: PLAN\nMODE: LOCAL\n\nPLAN:\nfixture';
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-playwright-'));
  const policy = {
    version: 1 as const,
    taskId: 'demo',
    browserControlProvider: 'PLAYWRIGHT_CLI' as const,
    discussion: { enabled: false },
    selectedAt: new Date(0).toISOString(),
  };
  const policies = new TaskInteractionPolicyStore(root);
  await policies.createOrVerify(policy);
  const marker = {
    conversationUrl: url,
    outgoingUserMessageId: 'user-1',
    previousAssistantMessageId: 'assistant-0',
  };
  const sends = vi.fn(async () => marker);
  const waits = vi.fn(async () => raw);
  const close = vi.fn(async () => {});
  const outbound = vi.fn(async (): Promise<LocalOutbound> => ({
    content: 'exact control\r\n',
    kind: 'PLANNER',
    iteration: 1,
  }));
  const connect = vi.fn(async () => ({
    selection: { conversationUrl: url },
    connection: { close },
    adapter: {
      isLoggedIn: async () => true,
      sendMessage: sends,
      waitForAssistantMessage: waits,
    } as unknown as BrowserAutomationSession,
  }));
  const dependencies = {
    root,
    activity: { getState: async () => 'PLANNING' as const },
    outbound,
    connect,
  };
  const create = () => new LocalPlaywrightTransport(dependencies);
  return {
    root,
    policy,
    policies,
    sends,
    waits,
    close,
    outbound,
    connect,
    create,
    store: new LocalPlaywrightProofStore(root),
    bindings: new TaskBrowserStore(root),
    gates: new StoredLocalLifecycleGates(root),
  };
}

describe('LOCAL Playwright exact proof', () => {
  it('persists intent before send and exact confirmed bytes before allowing lifecycle ingress', async () => {
    const f = await fixture();
    f.sends.mockImplementationOnce(async () => {
      expect((await f.store.read('demo'))?.operation.state).toBe('ATTEMPTED');
      expect((await f.bindings.read('demo'))?.conversation.url).toBe(url);
      await expect(
        f.gates.assertControlConfirmed('demo', sha256('exact control\r\n'), f.policy, {
          kind: 'PLANNER',
          iteration: 1,
        }),
      ).rejects.toThrow();
      return {
        conversationUrl: url,
        outgoingUserMessageId: 'user-1',
        previousAssistantMessageId: 'assistant-0',
      };
    });
    const proof = await f.create().send('demo', {}, url);
    expect(proof.operation.state).toBe('CONFIRMED');
    expect(proof.operation.outboundSha256).toBe(sha256('exact control\r\n'));
    expect(
      await readFile(f.store.artifactPath('demo', proof.operation.operationId, 'request'), 'utf8'),
    ).toBe('exact control\r\n');
    await f.gates.assertControlConfirmed('demo', proof.operation.outboundSha256, f.policy, {
      kind: 'PLANNER',
      iteration: 1,
    });
    const request = {
      taskId: 'demo',
      iteration: 1,
      source: 'BROWSER' as const,
      controlSha256: proof.operation.outboundSha256,
      response: raw,
    };
    await expect(f.gates.assertResponseReceived(request, f.policy)).rejects.toThrow();
    expect(await f.create().wait('demo')).toBe(raw);
    await f.gates.assertResponseReceived(request, f.policy);
    await expect(
      f.gates.assertResponseReceived({ ...request, response: raw + '\n' }, f.policy),
    ).rejects.toThrow();
    await expect(
      f.gates.assertControlConfirmed('demo', proof.operation.outboundSha256, f.policy, {
        kind: 'REVIEWER',
        iteration: 1,
      }),
    ).rejects.toThrow();
    await expect(
      f.gates.assertControlConfirmed('demo', proof.operation.outboundSha256, f.policy, {
        kind: 'PLANNER',
        iteration: 2,
      }),
    ).rejects.toThrow();
  });
  it('serializes competing sends and returns existing confirmation without sending twice', async () => {
    const f = await fixture();
    const results = await Promise.all([
      f.create().send('demo', {}, url),
      f.create().send('demo', {}, url),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(f.sends).toHaveBeenCalledTimes(1);
    await f.create().wait('demo');
    await f.create().wait('demo');
    expect(f.waits).toHaveBeenCalledTimes(1);
  });
  it('never retries an unknown send, even with a new control or after restarting', async () => {
    const f = await fixture();
    f.sends.mockRejectedValueOnce(new Error('unknown outcome'));
    await expect(f.create().send('demo', {}, url)).rejects.toThrow('unknown outcome');
    f.outbound.mockResolvedValue({ content: 'different', kind: 'PLANNER', iteration: 1 });
    await expect(f.create().send('demo', {}, url)).rejects.toMatchObject({
      code: 'LOCAL_PLAYWRIGHT_RESEND_FORBIDDEN',
    });
    await expect(f.create().wait('demo')).rejects.toThrow();
    expect(f.sends).toHaveBeenCalledTimes(1);
    expect(f.close).toHaveBeenCalledTimes(1);
  });
  it('does not release a confirmed operation merely because another outbound control exists', async () => {
    const f = await fixture();
    await f.create().send('demo', {}, url);
    f.outbound.mockResolvedValue({ content: 'next control', kind: 'REVIEWER', iteration: 1 });
    await expect(f.create().send('demo')).rejects.toMatchObject({
      code: 'LOCAL_PLAYWRIGHT_RESPONSE_PENDING',
    });
    expect(f.sends).toHaveBeenCalledTimes(1);
  });
  it('does not promote the legacy marker after confirmed-side checkpoint failure', async () => {
    const f = await fixture();
    const write = LocalPlaywrightProofStore.prototype.write;
    const proofWrite = vi
      .spyOn(LocalPlaywrightProofStore.prototype, 'write')
      .mockImplementation(async function (this: LocalPlaywrightProofStore, proof) {
        if (proof.operation.state === 'CONFIRMED') throw new Error('checkpoint crash');
        return write.call(this, proof);
      });
    await expect(f.create().send('demo', {}, url)).rejects.toThrow('checkpoint crash');
    expect((await f.bindings.read('demo'))?.pendingSend?.outgoingUserMessageId).toBe('user-1');
    proofWrite.mockRestore();
    await expect(f.create().send('demo', {}, url)).rejects.toMatchObject({
      code: 'LOCAL_PLAYWRIGHT_RESEND_FORBIDDEN',
    });
    expect((await f.store.read('demo'))?.operation.state).toBe('ATTEMPTED');
  });
  it('recovers response-publication crashes without rereading or overwriting the browser response', async () => {
    const f = await fixture();
    const proof = await f.create().send('demo', {}, url);
    const write = LocalPlaywrightProofStore.prototype.write;
    const proofWrite = vi
      .spyOn(LocalPlaywrightProofStore.prototype, 'write')
      .mockImplementation(async function (this: LocalPlaywrightProofStore, value) {
        if (value.operation.state === 'RESPONDED') throw new Error('response checkpoint crash');
        return write.call(this, value);
      });
    await expect(f.create().wait('demo')).rejects.toThrow('response checkpoint crash');
    proofWrite.mockRestore();
    f.waits.mockResolvedValue('must not overwrite');
    expect(await f.create().wait('demo')).toBe(raw);
    expect(f.waits).toHaveBeenCalledTimes(1);
    await expect(
      f.store.artifact('demo', proof.operation.operationId, 'response', 'replacement'),
    ).rejects.toThrow();
  });
  it('keeps confirmation on wait failure and permits a bounded wait retry, not a resend', async () => {
    const f = await fixture();
    await f.create().send('demo', {}, url);
    f.waits.mockRejectedValueOnce(new Error('timeout'));
    await expect(f.create().wait('demo')).rejects.toThrow('timeout');
    expect((await f.store.read('demo'))?.operation.state).toBe('CONFIRMED');
    expect(await f.create().wait('demo')).toBe(raw);
    expect(f.sends).toHaveBeenCalledTimes(1);
    await expect(f.create().wait('demo', 0)).rejects.toThrow();
    await expect(f.create().wait('demo', 120001)).rejects.toThrow();
  });
  it('fails closed on tampered proof identity and exact outbound bytes', async () => {
    const f = await fixture();
    const proof = await f.create().send('demo', {}, url);
    await writeFile(f.store.pathFor('demo'), JSON.stringify({ ...proof, taskId: 'other' }));
    await expect(f.create().wait('demo')).rejects.toThrow();
    await f.store.write(proof);
    await writeFile(
      f.store.artifactPath('demo', proof.operation.operationId, 'request'),
      'exact control\n',
    );
    await expect(
      f.gates.assertControlConfirmed('demo', proof.operation.outboundSha256, f.policy, {
        kind: 'PLANNER',
        iteration: 1,
      }),
    ).rejects.toThrow();
    expect(f.sends).toHaveBeenCalledTimes(1);
  });
  it('requires explicit provider, stable conversation and authoritative current control before sending', async () => {
    const f = await fixture();
    await expect(f.create().send('demo')).rejects.toMatchObject({
      code: 'CHATGPT_CONVERSATION_REQUIRED',
    });
    await expect(f.create().send('demo', {}, 'https://chatgpt.com/')).rejects.toThrow();
    f.outbound.mockRejectedValueOnce(new Error('drift or terminal state'));
    await expect(f.create().send('demo', {}, url)).rejects.toThrow('drift or terminal state');
    expect(f.sends).not.toHaveBeenCalled();
    const other = await fixture();
    await other.policies.setBeforeLock({
      ...other.policy,
      browserControlProvider: 'CODEX_BROWSER',
    });
    await expect(other.create().send('demo', {}, url)).rejects.toMatchObject({
      code: 'BROWSER_PROVIDER_MISMATCH',
    });
    expect(other.connect).not.toHaveBeenCalled();
  });
  it('refuses legacy pending sends and active foreign conversation owners', async () => {
    const f = await fixture();
    await f.bindings.write({
      version: 1,
      taskId: 'demo',
      conversation: { url, boundAt: new Date(0).toISOString() },
      pendingSend: { outgoingUserMessageId: 'legacy', sentAt: new Date(0).toISOString() },
    });
    await expect(f.create().send('demo', {}, url)).rejects.toMatchObject({
      code: 'LOCAL_TRANSPORT_PROOF_UNAVAILABLE',
    });
    const other = await fixture();
    await other.bindings.write({
      version: 1,
      taskId: 'other',
      conversation: { url, boundAt: new Date(0).toISOString() },
    });
    await expect(other.create().send('demo', {}, url)).rejects.toMatchObject({
      code: 'CHATGPT_CONVERSATION_ALREADY_BOUND',
    });
    expect(other.connect).not.toHaveBeenCalled();
  });
  it('leaves an attempt unconfirmed if the marker names a different conversation', async () => {
    const f = await fixture();
    f.sends.mockResolvedValueOnce({
      conversationUrl: 'https://chatgpt.com/c/other',
      outgoingUserMessageId: 'user-1',
      previousAssistantMessageId: 'assistant-0',
    });
    await expect(f.create().send('demo', {}, url)).rejects.toMatchObject({
      code: 'SEND_CHECKPOINT_PERSIST_FAILED',
    });
    expect((await f.store.read('demo'))?.operation.state).toBe('ATTEMPTED');
  });
  it('bounds control and response bytes before publishing authority', async () => {
    const f = await fixture();
    f.outbound.mockResolvedValueOnce({ content: '界'.repeat(3000), kind: 'PLANNER', iteration: 1 });
    await expect(f.create().send('demo', {}, url)).rejects.toThrow();
    expect(f.sends).not.toHaveBeenCalled();
    await f.create().send('demo', {}, url);
    f.waits.mockResolvedValueOnce('界'.repeat(22000));
    await expect(f.create().wait('demo')).rejects.toThrow();
    expect((await f.store.read('demo'))?.operation.state).toBe('CONFIRMED');
  });
});
