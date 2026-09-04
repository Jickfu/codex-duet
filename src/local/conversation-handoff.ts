import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ChatbridgeError } from '../core/errors.js';
import { TaskIdSchema } from '../core/domain.js';
import { ConversationBindingLock } from '../browser/conversation-binding-lock.js';
import {
  ConversationReservationService,
  type TaskActivityResolver,
} from '../browser/conversation-reservation.js';
import { ConversationUrlPolicy } from '../browser/conversation-url.js';
import { TaskBrowserStore } from '../browser/task-browser-store.js';
import { CodexBrowserControlStore } from '../duet/codex-browser-control-store.js';
import { TaskOperationLock } from '../duet/task-operation-lock.js';
import { TaskInteractionPolicyStore } from '../duet/interaction-policy-store.js';
import { canonicalJson, sha256 } from '../duet/task-spec.js';
import type { LocalRunV1 } from './lifecycle.js';

/** Caller supplies validated lifecycle status; no sends, lifecycle changes or response rewriting. */
export async function handoffLocalReviewer(
  root: string,
  input: {
    taskId: string;
    from: string;
    to: string;
    reason: string;
  },
  status: () => Promise<LocalRunV1>,
  activity: TaskActivityResolver,
) {
  const taskId = TaskIdSchema.parse(input.taskId);
  const urls = new ConversationUrlPolicy(['https://chatgpt.com']);
  const from = urls.canonicalizeStable(input.from);
  const to = urls.canonicalizeStable(input.to);
  if (from === to || !input.reason.trim() || input.reason.length > 4096) denied();
  return new TaskOperationLock(root).withLock(taskId, () =>
    new ConversationBindingLock(root).withLock(async () => {
      const run = await status();
      const localRun = await readFile(path.join(root, 'runs', taskId, 'local', 'run.json'), 'utf8');
      const policy = await new TaskInteractionPolicyStore(root).read(taskId);
      const store = new CodexBrowserControlStore(root);
      const current = await store.read(taskId);
      if (
        run.taskId !== taskId ||
        run.mode !== 'LOCAL' ||
        run.state !== 'EXECUTED' ||
        run.confirmed ||
        canonicalJson(JSON.parse(localRun)) !== canonicalJson(run) ||
        canonicalJson(policy) !== canonicalJson(run.policy) ||
        policy?.browserControlProvider !== 'CODEX_BROWSER' ||
        !current ||
        current.operation.state !== 'PREPARED' ||
        current.operation.kind !== 'REVIEWER' ||
        current.operation.iteration !== run.iteration ||
        current.operation.outboundSha256 !== sha256(run.control)
      )
        denied();
      // No mixed-mode or second-provider binding is eligible for this narrow transition.
      try {
        await readFile(path.join(root, 'runs', `${taskId}.json`));
        denied();
      } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error;
      }
      const browser = new TaskBrowserStore(root);
      if (await browser.read(taskId)) denied();
      const existing = await store.readHandoff(taskId, current.operation.operationId);
      const before = existing?.before ?? current;
      const after = { ...before, conversationUrl: to };
      if (
        before.conversationUrl !== from ||
        (canonicalJson(current) !== canonicalJson(before) &&
          canonicalJson(current) !== canonicalJson(after))
      )
        denied();
      const record = { version: 1 as const, before, after, localRun, reason: input.reason.trim() };
      if (existing && canonicalJson(existing) !== canonicalJson(record)) denied();
      await new ConversationReservationService(browser, activity, urls, store).assertAvailable(
        taskId,
        to,
        false,
      );
      await store.createHandoff(record);
      // A crash here leaves an immutable intent. Ordinary sends are blocked until this command recovers it.
      await store.write(after);
      return {
        taskId,
        from,
        to,
        operationId: after.operation.operationId,
        state: after.operation.state,
      };
    }),
  );
}

function denied(): never {
  throw new ChatbridgeError(
    'Only the exact unsent LOCAL Reviewer can change conversations',
    'LOCAL_HANDOFF_DENIED',
  );
}
