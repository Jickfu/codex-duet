import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserAutomationSession } from '../../src/browser/browser-automation-session.js';
import { ConversationBindingLock } from '../../src/browser/conversation-binding-lock.js';
import { ConversationReservationService } from '../../src/browser/conversation-reservation.js';
import { TaskBrowserStore } from '../../src/browser/task-browser-store.js';
import { BridgeTimeoutError, ChatbridgeError } from '../../src/core/errors.js';
import { DuetRunStore } from '../../src/duet/run-store.js';
import { TaskInteractionPolicyStore } from '../../src/duet/interaction-policy-store.js';
import { CodexBrowserControlStore } from '../../src/duet/codex-browser-control-store.js';
import type { DuetRunCheckpointV1 } from '../../src/duet/run.js';
import {
  taskAwareSend,
  taskAwareWait,
  type TaskBrowserDependencies,
} from '../../src/cli/task-browser.js';

const roots: string[] = [];
async function root() {
  const value = await mkdtemp(path.join(os.tmpdir(), 'task-control-'));
  roots.push(value);
  return value;
}
function run(taskId: string, state: DuetRunCheckpointV1['state'] = 'PLANNING') {
  const now = new Date(0).toISOString();
  const plan = { sha256: 'c'.repeat(64) };
  const reviewTarget = {
    mode: 'GITHUB' as const,
    repository: 'owner/repo',
    remote: 'origin',
    taskId,
    taskBranch: `agent/task-${taskId}`,
    baseRef: 'a'.repeat(40),
    reviewRef: 'd'.repeat(40),
    testStatus: 'PASS' as const,
  };
  return {
    version: 1 as const,
    taskId,
    mode: 'GITHUB' as const,
    iteration: 1,
    state,
    context: {
      mode: 'GITHUB' as const,
      repository: 'owner/repo',
      remote: 'origin',
      taskId,
      taskBranch: `agent/task-${taskId}`,
      baseRef: 'a'.repeat(40),
    },
    request: { sha256: 'b'.repeat(64) },
    ...(['PLAN', 'EXECUTING', 'EXECUTED', 'REVIEWING', 'DONE'].includes(state) ? { plan } : {}),
    ...(['EXECUTED', 'REVIEWING', 'DONE'].includes(state) ? { reviewTarget } : {}),
    ...(state === 'BLOCKED' ? { blockedPhase: 'PLANNING' as const } : {}),
    createdAt: now,
    updatedAt: now,
  } as DuetRunCheckpointV1;
}

async function fixture(
  selected = 'https://chatgpt.com/c/shared',
  waitResults: Array<string | Error> = ['response'],
) {
  const stateRoot = await root();
  const runs = new DuetRunStore(stateRoot);
  const store = new TaskBrowserStore(stateRoot);
  const codexBrowser = new CodexBrowserControlStore(stateRoot);
  const sends = vi.fn(async () => ({
    conversationUrl: selected,
    outgoingUserMessageId: 'user_new',
    previousAssistantMessageId: 'assistant_old',
  }));
  const waits = vi.fn(async () => {
    const value = waitResults.shift() ?? 'response';
    if (value instanceof Error) throw value;
    return value;
  });
  const connects: Array<string | undefined> = [];
  const adapter = {
    connect: vi.fn(async (options = {}) => ({
      conversationUrl: options.conversationUrl ?? selected,
    })),
    ensureConversation: vi.fn(),
    isLoggedIn: vi.fn(async () => true),
    sendMessage: sends,
    waitForAssistantMessage: waits,
    close: vi.fn(),
  } satisfies BrowserAutomationSession;
  const dependencies: TaskBrowserDependencies = {
    stateRoot,
    allowedOrigins: ['https://chatgpt.com'],
    store,
    runs,
    codexBrowser,
    lock: new ConversationBindingLock(stateRoot, 5000),
    connect: async (conversationUrl) => {
      connects.push(conversationUrl);
      return {
        adapter,
        selection: { conversationUrl: conversationUrl ?? selected },
        connection: { close: async () => undefined },
      };
    },
    now: () => new Date(1).toISOString(),
  };
  return { stateRoot, runs, store, codexBrowser, sends, waits, connects, adapter, dependencies };
}

afterEach(async () =>
  Promise.all(roots.splice(0).map((item) => rm(item, { recursive: true, force: true }))),
);

describe('task-aware Browser control', () => {
  it('shares conversation reservation with CODEX_BROWSER tasks', async () => {
    const x = await fixture();
    await x.runs.write(run('task1'));
    await x.runs.write(run('owner'));
    await x.codexBrowser.write({
      version: 1,
      taskId: 'owner',
      provider: 'CODEX_BROWSER',
      conversationUrl: 'https://chatgpt.com/c/shared',
      operation: {
        operationId: 'e'.repeat(64),
        kind: 'PLANNER',
        iteration: 1,
        outboundSha256: 'f'.repeat(64),
        state: 'RESPONDED',
        preparedAt: new Date(0).toISOString(),
        completedAt: new Date(1).toISOString(),
        inboundSha256: 'd'.repeat(64),
      },
    });
    await expect(
      taskAwareSend('message', 'task1', 'https://chatgpt.com/c/shared', x.dependencies),
    ).rejects.toMatchObject({ code: 'CHATGPT_CONVERSATION_ALREADY_BOUND' });
    expect(x.sends).not.toHaveBeenCalled();
  });

  it('refuses the Playwright path when the task selected CODEX_BROWSER', async () => {
    const x = await fixture();
    await x.runs.write(run('task1'));
    const policies = new TaskInteractionPolicyStore(x.stateRoot);
    await policies.createOrVerify({
      version: 1,
      taskId: 'task1',
      browserControlProvider: 'CODEX_BROWSER',
      discussion: { enabled: false },
      selectedAt: new Date(0).toISOString(),
    });
    x.dependencies.policies = policies;
    await expect(
      taskAwareSend('message', 'task1', undefined, x.dependencies),
    ).rejects.toMatchObject({ code: 'BROWSER_PROVIDER_MISMATCH' });
    expect(x.sends).not.toHaveBeenCalled();
  });

  it('rejects unknown tasks without creating an orphan sidecar', async () => {
    const x = await fixture();
    await expect(
      taskAwareSend('message', 'missing', undefined, x.dependencies),
    ).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' });
    expect(await x.store.read('missing')).toBeUndefined();
    expect(x.sends).not.toHaveBeenCalled();
  });

  it('does not read or overwrite the legacy global SessionStore', async () => {
    const x = await fixture();
    await x.runs.write(run('task-a'));
    const legacy = path.join(x.stateRoot, 'session.json');
    await mkdir(path.dirname(legacy), { recursive: true });
    await writeFile(legacy, '{"legacy":true}', 'utf8');
    await taskAwareSend('message', 'task-a', 'https://chatgpt.com/c/shared', x.dependencies);
    expect(await readFile(legacy, 'utf8')).toBe('{"legacy":true}');
  });

  it('re-pins an unbound discovery after reservation and cannot persist another current tab', async () => {
    const x = await fixture('https://chatgpt.com/c/one');
    await x.runs.write(run('task-a'));
    const reservation = vi.spyOn(ConversationReservationService.prototype, 'assertAvailable');
    await taskAwareSend('message', 'task-a', undefined, x.dependencies);
    expect(x.connects).toEqual([undefined]);
    expect(x.sends).toHaveBeenCalledOnce();
    expect(x.adapter.connect).toHaveBeenCalledWith({
      conversationUrl: 'https://chatgpt.com/c/one',
    });
    expect(reservation.mock.invocationCallOrder[0]).toBeLessThan(
      x.adapter.connect.mock.invocationCallOrder[0]!,
    );
    expect(x.adapter.connect.mock.invocationCallOrder[0]).toBeLessThan(
      x.adapter.isLoggedIn.mock.invocationCallOrder[0]!,
    );
    expect(x.adapter.isLoggedIn.mock.invocationCallOrder[0]).toBeLessThan(
      x.sends.mock.invocationCallOrder[0]!,
    );
    expect((await x.store.read('task-a'))?.conversation.url).toBe('https://chatgpt.com/c/one');
    expect((await x.store.read('task-a'))?.conversation.url).not.toBe('https://chatgpt.com/c/two');
  });

  it('persists and waits on C1 after blank bootstrap send readiness becomes actionable', async () => {
    const x = await fixture('https://chatgpt.com/');
    await x.runs.write(run('task-a'));
    const sendBoundary: string[] = [];
    x.sends.mockImplementationOnce(async () => {
      sendBoundary.push(
        'filled',
        'button-not-ready',
        'button-ready',
        'actual-click',
        'outgoing-id',
      );
      return {
        conversationUrl: 'https://chatgpt.com/c/new-conversation',
        outgoingUserMessageId: 'user_new',
        previousAssistantMessageId: 'assistant_old',
      };
    });
    const reservation = vi.spyOn(ConversationReservationService.prototype, 'assertAvailable');
    await taskAwareSend('message', 'task-a', undefined, x.dependencies);
    expect((await x.store.read('task-a'))?.conversation.url).toBe(
      'https://chatgpt.com/c/new-conversation',
    );
    expect(reservation).toHaveBeenCalledTimes(1);
    expect(reservation).toHaveBeenCalledWith(
      'task-a',
      'https://chatgpt.com/c/new-conversation',
      false,
    );
    await taskAwareWait('task-a', 10, x.dependencies);
    expect(x.connects).toEqual([undefined, 'https://chatgpt.com/c/new-conversation']);
    expect(sendBoundary).toEqual([
      'filled',
      'button-not-ready',
      'button-ready',
      'actual-click',
      'outgoing-id',
    ]);
  });

  it('rejects a generic explicit bootstrap before connect or send', async () => {
    const x = await fixture('https://chatgpt.com/');
    await x.runs.write(run('task-a'));
    await expect(
      taskAwareSend('message', 'task-a', 'https://chatgpt.com/', x.dependencies),
    ).rejects.toMatchObject({ code: 'CHATGPT_CONVERSATION_IDENTITY_REQUIRED' });
    expect(x.connects).toEqual([]);
    expect(x.sends).not.toHaveBeenCalled();
  });

  it('fails closed when a confirmed marker still has a generic URL', async () => {
    const x = await fixture('https://chatgpt.com/');
    await x.runs.write(run('task-a'));
    await expect(
      taskAwareSend('message', 'task-a', undefined, x.dependencies),
    ).rejects.toMatchObject({ code: 'SEND_CHECKPOINT_PERSIST_FAILED' });
    expect(x.sends).toHaveBeenCalledOnce();
    expect(await x.store.read('task-a')).toBeUndefined();
  });

  it('reports recovery-required when a blank bootstrap produces an already active identity', async () => {
    const x = await fixture('https://chatgpt.com/');
    await x.runs.write(run('task-a'));
    await x.runs.write(run('owner'));
    await x.store.write({
      version: 1,
      taskId: 'owner',
      conversation: {
        url: 'https://chatgpt.com/c/collision',
        boundAt: new Date(0).toISOString(),
      },
    });
    x.sends.mockResolvedValueOnce({
      conversationUrl: 'https://chatgpt.com/c/collision',
      outgoingUserMessageId: 'user_new',
      previousAssistantMessageId: 'assistant_old',
    });
    await expect(
      taskAwareSend('message', 'task-a', undefined, x.dependencies),
    ).rejects.toMatchObject({ code: 'SEND_CHECKPOINT_PERSIST_FAILED' });
    expect(x.sends).toHaveBeenCalledOnce();
    expect(await x.store.read('task-a')).toBeUndefined();
  });

  it('serializes concurrent bootstrap and rejects the loser before send', async () => {
    const x = await fixture();
    await x.runs.write(run('task-a'));
    await x.runs.write(run('task-b'));
    const independentLockBoundary = {
      ...x.dependencies,
      lock: new ConversationBindingLock(x.stateRoot, 5000),
    };
    const results = await Promise.allSettled([
      taskAwareSend('A', 'task-a', 'https://chatgpt.com/c/shared', x.dependencies),
      taskAwareSend('B', 'task-b', 'https://chatgpt.com/c/shared', independentLockBoundary),
    ]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((item) => item.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'CHATGPT_CONVERSATION_ALREADY_BOUND' });
    expect(x.sends).toHaveBeenCalledTimes(1);
  });

  it('treats BLOCKED as active and requires explicit reuse for terminal history', async () => {
    const x = await fixture();
    await x.runs.write(run('blocked', 'BLOCKED'));
    await x.runs.write(run('new-task'));
    await x.store.write({
      version: 1,
      taskId: 'blocked',
      conversation: { url: 'https://chatgpt.com/c/shared', boundAt: new Date(0).toISOString() },
    });
    await expect(taskAwareSend('new', 'new-task', undefined, x.dependencies)).rejects.toMatchObject(
      { code: 'CHATGPT_CONVERSATION_ALREADY_BOUND' },
    );

    await x.runs.write(run('blocked', 'DONE'));
    await expect(taskAwareSend('new', 'new-task', undefined, x.dependencies)).rejects.toMatchObject(
      { code: 'CHATGPT_CONVERSATION_REQUIRES_EXPLICIT_BINDING' },
    );
    await taskAwareSend('new', 'new-task', 'https://chatgpt.com/c/shared', x.dependencies);
    await taskAwareSend('next', 'new-task', undefined, x.dependencies);
    expect(x.sends).toHaveBeenCalledTimes(2);
  });

  it('routes bound send exactly and atomically replaces pending send only after confirmation', async () => {
    const x = await fixture('https://chatgpt.com/c/bound');
    await x.runs.write(run('task-a'));
    await x.store.write({
      version: 1,
      taskId: 'task-a',
      conversation: { url: 'https://chatgpt.com/c/bound', boundAt: new Date(0).toISOString() },
      pendingSend: { outgoingUserMessageId: 'user_old', sentAt: new Date(0).toISOString() },
    });
    await taskAwareSend('next', 'task-a', undefined, x.dependencies);
    expect(x.connects).toEqual(['https://chatgpt.com/c/bound']);
    expect((await x.store.read('task-a'))?.pendingSend?.outgoingUserMessageId).toBe('user_new');
  });

  it('keeps an existing binding immutable when confirmed send identity changes', async () => {
    const x = await fixture('https://chatgpt.com/c/bound');
    await x.runs.write(run('task-a'));
    const old = {
      version: 1 as const,
      taskId: 'task-a',
      conversation: { url: 'https://chatgpt.com/c/bound', boundAt: new Date(0).toISOString() },
      pendingSend: { outgoingUserMessageId: 'user_old', sentAt: new Date(0).toISOString() },
    };
    await x.store.write(old);
    x.sends.mockResolvedValueOnce({
      conversationUrl: 'https://chatgpt.com/c/other',
      outgoingUserMessageId: 'user_new',
      previousAssistantMessageId: 'assistant_old',
    });
    await expect(
      taskAwareSend('message', 'task-a', undefined, x.dependencies),
    ).rejects.toMatchObject({ code: 'SEND_CHECKPOINT_PERSIST_FAILED' });
    expect(await x.store.read('task-a')).toEqual(old);
    expect(x.sends).toHaveBeenCalledOnce();
  });

  it('accepts a redundant exact bootstrap target and rejects implicit rebind before connect', async () => {
    const x = await fixture('https://chatgpt.com/c/bound');
    await x.runs.write(run('task-a'));
    await x.store.write({
      version: 1,
      taskId: 'task-a',
      conversation: { url: 'https://chatgpt.com/c/bound', boundAt: new Date(0).toISOString() },
    });
    await taskAwareSend('same', 'task-a', 'HTTPS://CHATGPT.COM:443/c/bound', x.dependencies);
    await expect(
      taskAwareSend('different', 'task-a', 'https://chatgpt.com/c/different', x.dependencies),
    ).rejects.toMatchObject({ code: 'CHATGPT_CONVERSATION_BINDING_CONFLICT' });
    expect(x.connects).toEqual(['https://chatgpt.com/c/bound']);
    expect(x.sends).toHaveBeenCalledTimes(1);
  });

  it('keeps the same conversation across multi-round sends', async () => {
    const x = await fixture('https://chatgpt.com/c/multi-round');
    await x.runs.write(run('task-a'));
    await taskAwareSend('planning', 'task-a', 'https://chatgpt.com/c/multi-round', x.dependencies);
    await taskAwareSend('review 1', 'task-a', undefined, x.dependencies);
    await taskAwareSend('review 2', 'task-a', undefined, x.dependencies);
    expect(x.connects).toEqual([
      'https://chatgpt.com/c/multi-round',
      'https://chatgpt.com/c/multi-round',
      'https://chatgpt.com/c/multi-round',
    ]);
    expect(x.sends).toHaveBeenCalledTimes(3);
    expect((await x.store.read('task-a'))?.conversation.url).toBe(
      'https://chatgpt.com/c/multi-round',
    );
  });

  it('reads the task checkpoint before exact connect and preserves it across timeout recovery', async () => {
    const x = await fixture('https://chatgpt.com/c/bound', [
      new BridgeTimeoutError('timeout'),
      'done',
    ]);
    await x.runs.write(run('task-a'));
    await x.store.write({
      version: 1,
      taskId: 'task-a',
      conversation: { url: 'https://chatgpt.com/c/bound', boundAt: new Date(0).toISOString() },
      pendingSend: { outgoingUserMessageId: 'user_anchor', sentAt: new Date(0).toISOString() },
    });
    const events: string[] = [];
    const originalRead = x.store.read.bind(x.store);
    vi.spyOn(x.store, 'read').mockImplementation(async (taskId) => {
      events.push('read');
      return originalRead(taskId);
    });
    const originalConnect = x.dependencies.connect;
    x.dependencies.connect = async (target) => {
      events.push(`connect:${target}`);
      return originalConnect(target);
    };
    await expect(taskAwareWait('task-a', 10, x.dependencies)).rejects.toMatchObject({
      code: 'BRIDGE_TIMEOUT',
    });
    expect(await taskAwareWait('task-a', 10, x.dependencies)).toBe('done');
    const firstConnect = events.indexOf('connect:https://chatgpt.com/c/bound');
    expect(firstConnect).toBeGreaterThan(0);
    expect(events.slice(0, firstConnect).every((event) => event === 'read')).toBe(true);
    expect(x.sends).not.toHaveBeenCalled();
    expect((await originalRead('task-a'))?.pendingSend?.outgoingUserMessageId).toBe('user_anchor');
  });

  it('reports confirmed-send persistence failure without resending or deleting old pending state', async () => {
    const x = await fixture('https://chatgpt.com/c/bound');
    await x.runs.write(run('task-a'));
    const old = {
      version: 1 as const,
      taskId: 'task-a',
      conversation: { url: 'https://chatgpt.com/c/bound', boundAt: new Date(0).toISOString() },
      pendingSend: { outgoingUserMessageId: 'user_old', sentAt: new Date(0).toISOString() },
    };
    await x.store.write(old);
    vi.spyOn(x.store, 'write').mockRejectedValueOnce(new Error('disk full'));
    await expect(taskAwareSend('next', 'task-a', undefined, x.dependencies)).rejects.toMatchObject({
      code: 'SEND_CHECKPOINT_PERSIST_FAILED',
    });
    expect(x.sends).toHaveBeenCalledTimes(1);
    expect((await x.store.read('task-a'))?.pendingSend?.outgoingUserMessageId).toBe('user_old');
  });

  it('preserves the old pending marker when the next send outcome is unknown', async () => {
    const x = await fixture('https://chatgpt.com/c/bound');
    await x.runs.write(run('task-a'));
    await x.store.write({
      version: 1,
      taskId: 'task-a',
      conversation: { url: 'https://chatgpt.com/c/bound', boundAt: new Date(0).toISOString() },
      pendingSend: { outgoingUserMessageId: 'user_old', sentAt: new Date(0).toISOString() },
    });
    x.sends.mockRejectedValueOnce(new ChatbridgeError('unknown', 'SEND_OUTCOME_UNKNOWN'));
    await expect(taskAwareSend('next', 'task-a', undefined, x.dependencies)).rejects.toMatchObject({
      code: 'SEND_OUTCOME_UNKNOWN',
    });
    expect(x.sends).toHaveBeenCalledTimes(1);
    expect((await x.store.read('task-a'))?.pendingSend?.outgoingUserMessageId).toBe('user_old');
  });
});
