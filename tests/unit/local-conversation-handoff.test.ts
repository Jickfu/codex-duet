import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { localSpec } from '../fixtures/local-task-spec.js';
import { handoffLocalReviewer } from '../../src/local/conversation-handoff.js';
import type { LocalRunV1 } from '../../src/local/lifecycle.js';
import { CodexBrowserControlStore } from '../../src/duet/codex-browser-control-store.js';
import { TaskInteractionPolicyStore } from '../../src/duet/interaction-policy-store.js';
import { canonicalJson, sha256 } from '../../src/duet/task-spec.js';
import { ConversationReservationService } from '../../src/browser/conversation-reservation.js';
import { ConversationUrlPolicy } from '../../src/browser/conversation-url.js';
import { TaskBrowserStore } from '../../src/browser/task-browser-store.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-handoff-'));
  const policy = {
    version: 1 as const,
    taskId: 'demo',
    browserControlProvider: 'CODEX_BROWSER' as const,
    discussion: { enabled: false },
    selectedAt: new Date(0).toISOString(),
  };
  await new TaskInteractionPolicyStore(root).createOrVerify(policy);
  const run: LocalRunV1 = {
    version: 1,
    mode: 'LOCAL',
    taskId: 'demo',
    spec: localSpec(),
    policy,
    state: 'EXECUTED',
    iteration: 1,
    maxIterations: 5,
    control: 'exact reviewer bytes',
    confirmed: false,
    reviews: [],
    responses: [],
  };
  const store = new CodexBrowserControlStore(root);
  const outboundSha256 = sha256(run.control);
  const operation = {
    operationId: sha256(
      JSON.stringify({ taskId: 'demo', kind: 'REVIEWER', iteration: 1, outboundSha256 }),
    ),
    kind: 'REVIEWER' as const,
    iteration: 1,
    outboundSha256,
    state: 'PREPARED' as const,
    preparedAt: new Date(0).toISOString(),
  };
  const from = 'https://chatgpt.com/c/original';
  const to = 'https://chatgpt.com/c/replacement';
  await store.write({
    version: 1,
    taskId: 'demo',
    provider: 'CODEX_BROWSER',
    conversationUrl: from,
    operation,
  });
  const file = path.join(root, 'runs/demo/local/run.json');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, canonicalJson(run) + '\n');
  const activity = { getState: async () => 'EXECUTED' as const };
  const input = { taskId: 'demo', from, to, reason: 'User approved reconnection handoff' };
  const migrate = () => handoffLocalReviewer(root, input, async () => run, activity);
  return { root, store, run, file, input, activity, migrate, operation };
}

describe('explicit LOCAL Reviewer conversation handoff', () => {
  it('preserves exact control, lifecycle and prior response artifacts, and is idempotent', async () => {
    const f = await fixture();
    const before = await f.store.read('demo');
    const bytes = await readFile(f.file);
    await f.store.createResponseArtifact('demo', 'a'.repeat(64), 'old reply');
    await f.migrate();
    expect(await f.store.read('demo')).toEqual({ ...before, conversationUrl: f.input.to });
    expect(await readFile(f.file)).toEqual(bytes);
    expect((await f.store.readHandoff('demo', f.operation.operationId))?.localRun).toBe(
      bytes.toString(),
    );
    expect(await f.migrate()).toMatchObject({ state: 'PREPARED' });
    expect(
      await readFile(
        path.join(f.root, 'runs/demo/codex-browser', 'a'.repeat(64), 'response.txt'),
        'utf8',
      ),
    ).toBe('old reply');
    f.input.to = 'https://chatgpt.com/c/third';
    await expect(f.migrate()).rejects.toThrow();
  });
  it.each(['ATTEMPTED', 'OUTCOME_UNKNOWN', 'CONFIRMED', 'RESPONDED'] as const)(
    'denies %s without mutation',
    async (state) => {
      const f = await fixture();
      const before = (await f.store.read('demo'))!;
      await f.store.write({
        ...before,
        operation: { ...before.operation, state, completedAt: new Date(0).toISOString() },
      });
      await expect(f.migrate()).rejects.toMatchObject({ code: 'LOCAL_HANDOFF_DENIED' });
      expect(await f.store.readHandoff('demo', f.operation.operationId)).toBeUndefined();
    },
  );
  it('blocks sends after an intent-only crash and recovers only the exact intent', async () => {
    const f = await fixture();
    const original = f.store.write;
    const failure = vi
      .spyOn(CodexBrowserControlStore.prototype, 'write')
      .mockRejectedValueOnce(new Error('crash'));
    await expect(f.migrate()).rejects.toThrow('crash');
    failure.mockRestore();
    const send = vi.fn();
    await expect(f.store.withOperationLock('demo', send)).rejects.toMatchObject({
      code: 'LOCAL_HANDOFF_PENDING',
    });
    expect(send).not.toHaveBeenCalled();
    f.input.reason = 'changed';
    await expect(f.migrate()).rejects.toThrow();
    f.input.reason = 'User approved reconnection handoff';
    await f.migrate();
    await f.store.withOperationLock('demo', send);
    expect(send).toHaveBeenCalledOnce();
    expect(f.store.write).toBe(original);
  });
  it('rejects an occupied destination and reserves both old and new conversations', async () => {
    const f = await fixture();
    const browser = new TaskBrowserStore(f.root);
    await browser.write({
      version: 1,
      taskId: 'other',
      conversation: { url: f.input.to, boundAt: new Date(0).toISOString() },
    });
    await expect(f.migrate()).rejects.toMatchObject({ code: 'CHATGPT_CONVERSATION_ALREADY_BOUND' });
    await browser.write({
      version: 1,
      taskId: 'other',
      conversation: { url: 'https://chatgpt.com/c/unrelated', boundAt: new Date(0).toISOString() },
    });
    await f.migrate();
    const reservations = new ConversationReservationService(
      browser,
      f.activity,
      new ConversationUrlPolicy(['https://chatgpt.com']),
      f.store,
    );
    for (const url of [f.input.from, f.input.to])
      await expect(reservations.assertAvailable('third', url, false)).rejects.toMatchObject({
        code: 'CHATGPT_CONVERSATION_ALREADY_BOUND',
      });
  });
  it.each(['control', 'provider', 'state', 'from'] as const)(
    'rejects changed %s authority',
    async (field) => {
      const f = await fixture();
      if (field === 'control') f.run.control += '!';
      if (field === 'provider') f.run.policy.browserControlProvider = 'PLAYWRIGHT_CLI';
      if (field === 'state') f.run.state = 'REVIEWING';
      if (field === 'from') f.input.from = 'https://chatgpt.com/c/wrong';
      await writeFile(f.file, canonicalJson(f.run) + '\n');
      await expect(f.migrate()).rejects.toMatchObject({ code: 'LOCAL_HANDOFF_DENIED' });
    },
  );
});
