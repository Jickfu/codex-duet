import type { TaskState } from '../core/protocol.js';
import { ChatbridgeError } from '../core/errors.js';
import type { TaskBrowserStore } from './task-browser-store.js';
import type { ConversationUrlPolicy } from './conversation-url.js';

export interface TaskActivityResolver {
  getState(taskId: string): Promise<TaskState | undefined>;
}

const TERMINAL = new Set<TaskState>(['DONE', 'FAILED', 'CANCELLED']);

export class ConversationReservationService {
  constructor(
    private readonly store: TaskBrowserStore,
    private readonly tasks: TaskActivityResolver,
    private readonly urls: ConversationUrlPolicy,
  ) {}

  async assertTaskExists(taskId: string): Promise<TaskState> {
    const state = await this.tasks.getState(taskId);
    if (!state) throw new ChatbridgeError(`Run not found for ${taskId}`, 'RUN_NOT_FOUND');
    return state;
  }

  async assertAvailable(
    taskId: string,
    conversationUrl: string,
    explicitHistoricalReuse: boolean,
  ): Promise<void> {
    const target = this.urls.canonicalize(conversationUrl);
    for (const binding of await this.store.list()) {
      if (binding.taskId === taskId) continue;
      if (this.urls.canonicalize(binding.conversation.url) !== target) continue;
      const state = await this.tasks.getState(binding.taskId);
      if (!state)
        throw new ChatbridgeError(
          `Cannot determine owner state for conversation binding ${binding.taskId}`,
          'CHATGPT_CONVERSATION_BINDING_OWNER_UNKNOWN',
        );
      if (!TERMINAL.has(state))
        throw new ChatbridgeError(
          'ChatGPT conversation is already bound to an active task',
          'CHATGPT_CONVERSATION_ALREADY_BOUND',
        );
      if (!explicitHistoricalReuse)
        throw new ChatbridgeError(
          'Historical ChatGPT conversation requires explicit binding',
          'CHATGPT_CONVERSATION_REQUIRES_EXPLICIT_BINDING',
        );
    }
  }
}
