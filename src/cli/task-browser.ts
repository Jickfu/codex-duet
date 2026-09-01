import path from 'node:path';
import process from 'node:process';
import type { BrowserAutomationSession } from '../browser/browser-automation-session.js';
import { ConversationBindingLock } from '../browser/conversation-binding-lock.js';
import { ConversationReservationService } from '../browser/conversation-reservation.js';
import { ConversationUrlPolicy } from '../browser/conversation-url.js';
import { TaskBrowserStore, type TaskBrowserBindingV1 } from '../browser/task-browser-store.js';
import { loadConfig } from '../config/config.js';
import { ChatbridgeError } from '../core/errors.js';
import { DuetRunStore } from '../duet/run-store.js';
import { runtime } from './runtime.js';

interface ConnectedRuntime {
  adapter: BrowserAutomationSession;
  selection: { conversationUrl: string };
  connection: { close(): Promise<void> };
}

export interface TaskBrowserDependencies {
  stateRoot: string;
  allowedOrigins: readonly string[];
  store: TaskBrowserStore;
  runs: DuetRunStore;
  lock: ConversationBindingLock;
  connect(conversationUrl?: string): Promise<ConnectedRuntime>;
  now(): string;
}

export function productionTaskBrowserDependencies(): TaskBrowserDependencies {
  const stateRoot = path.resolve(process.cwd(), '.chatbridge');
  const config = loadConfig();
  return {
    stateRoot,
    allowedOrigins: config.allowedOrigins,
    store: new TaskBrowserStore(stateRoot),
    runs: new DuetRunStore(stateRoot),
    lock: new ConversationBindingLock(stateRoot),
    connect: (conversationUrl?: string) => runtime(conversationUrl ? { conversationUrl } : {}),
    now: () => new Date().toISOString(),
  };
}

export async function taskAwareSend(
  message: string,
  taskId: string,
  conversationUrl: string | undefined,
  dependencies: TaskBrowserDependencies = productionTaskBrowserDependencies(),
): Promise<void> {
  const urls = new ConversationUrlPolicy(dependencies.allowedOrigins);
  const reservations = new ConversationReservationService(
    dependencies.store,
    { getState: async (id) => (await dependencies.runs.read(id))?.state },
    urls,
  );
  await dependencies.lock.withLock(async () => {
    await reservations.assertTaskExists(taskId);
    const existing = await dependencies.store.read(taskId);
    const explicit = conversationUrl ? urls.canonicalize(conversationUrl) : undefined;
    if (existing && explicit && explicit !== urls.canonicalize(existing.conversation.url))
      throw new ChatbridgeError(
        'Explicit conversation URL conflicts with the durable task binding',
        'CHATGPT_CONVERSATION_BINDING_CONFLICT',
      );
    const target = existing ? urls.canonicalize(existing.conversation.url) : explicit;
    const connected = await dependencies.connect(target);
    try {
      const selected = urls.canonicalize(connected.selection.conversationUrl);
      if (target && selected !== target)
        throw new ChatbridgeError(
          'Browser selected a different ChatGPT conversation',
          'CHATGPT_CONVERSATION_UNAVAILABLE',
        );
      await reservations.assertAvailable(taskId, selected, Boolean(existing || explicit));
      if (!(await connected.adapter.isLoggedIn()))
        throw new Error(
          'ChatGPT is not logged in. Run `chatbridge browser open`, log in manually, then retry.',
        );
      const marker = await connected.adapter.sendMessage(message);
      const confirmed = urls.canonicalize(marker.conversationUrl);
      if (existing && confirmed !== urls.canonicalize(existing.conversation.url))
        throw new ChatbridgeError(
          'Send was confirmed but the conversation identity changed; do not resend automatically',
          'SEND_CHECKPOINT_PERSIST_FAILED',
        );
      try {
        await reservations.assertAvailable(taskId, confirmed, Boolean(existing || explicit));
      } catch (error) {
        throw new ChatbridgeError(
          `Send was confirmed but its conversation reservation could not be persisted safely; do not resend automatically${error instanceof ChatbridgeError ? `: ${error.code}` : ''}`,
          'SEND_CHECKPOINT_PERSIST_FAILED',
        );
      }
      const value: TaskBrowserBindingV1 = {
        version: 1,
        taskId,
        conversation: {
          url: confirmed,
          boundAt: existing?.conversation.boundAt ?? dependencies.now(),
        },
        pendingSend: {
          outgoingUserMessageId: marker.outgoingUserMessageId,
          ...(marker.previousAssistantMessageId
            ? { previousAssistantMessageId: marker.previousAssistantMessageId }
            : {}),
          sentAt: dependencies.now(),
        },
      };
      try {
        await dependencies.store.write(value);
      } catch (error) {
        throw new ChatbridgeError(
          `Send was confirmed but its task checkpoint could not be persisted; do not resend automatically${error instanceof Error ? `: ${error.message}` : ''}`,
          'SEND_CHECKPOINT_PERSIST_FAILED',
        );
      }
    } finally {
      await connected.connection.close();
    }
  });
}

export async function taskAwareWait(
  taskId: string,
  timeout: number | undefined,
  dependencies: TaskBrowserDependencies = productionTaskBrowserDependencies(),
): Promise<string> {
  const run = await dependencies.runs.read(taskId);
  if (!run) throw new ChatbridgeError(`Run not found for ${taskId}`, 'RUN_NOT_FOUND');
  const binding = await dependencies.store.read(taskId);
  if (!binding)
    throw new ChatbridgeError(
      `No browser binding for ${taskId}; run task-aware send first`,
      'TASK_BROWSER_BINDING_NOT_FOUND',
    );
  if (!binding.pendingSend)
    throw new ChatbridgeError(
      `No pending send checkpoint for ${taskId}`,
      'TASK_SEND_CHECKPOINT_NOT_FOUND',
    );
  const urls = new ConversationUrlPolicy(dependencies.allowedOrigins);
  const target = urls.canonicalize(binding.conversation.url);
  const reservations = new ConversationReservationService(
    dependencies.store,
    { getState: async (id) => (await dependencies.runs.read(id))?.state },
    urls,
  );
  await reservations.assertAvailable(taskId, target, true);
  const pending = binding.pendingSend;
  const connected = await dependencies.connect(target);
  try {
    if (urls.canonicalize(connected.selection.conversationUrl) !== target)
      throw new ChatbridgeError(
        'Browser selected a different ChatGPT conversation',
        'CHATGPT_CONVERSATION_UNAVAILABLE',
      );
    return await connected.adapter.waitForAssistantMessage({
      checkpoint: {
        conversationUrl: target,
        outgoingUserMessageId: pending.outgoingUserMessageId,
        ...(pending.previousAssistantMessageId
          ? { previousAssistantMessageId: pending.previousAssistantMessageId }
          : {}),
      },
      ...(timeout ? { timeoutMs: timeout } : {}),
    });
  } finally {
    await connected.connection.close();
  }
}
