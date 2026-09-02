import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ChatbridgeError } from '../core/errors.js';
import { ConversationUrlPolicy } from '../browser/conversation-url.js';
import { ConversationReservationService } from '../browser/conversation-reservation.js';
import type { TaskBrowserStore } from '../browser/task-browser-store.js';
import type { ConversationBindingLock } from '../browser/conversation-binding-lock.js';
import type { DuetRunStore } from './run-store.js';
import { CodexBrowserControlStore } from './codex-browser-control-store.js';
import type { CodexBrowserControlV1 } from './codex-browser-control.js';
import { TaskInteractionPolicyStore } from './interaction-policy-store.js';
import {
  TaskInteractionPolicyV1Schema,
  type TaskInteractionPolicyV1,
} from './interaction-policy.js';

export class InteractionService {
  constructor(
    private readonly policies: TaskInteractionPolicyStore,
    private readonly codexBrowser: CodexBrowserControlStore,
    private readonly allowedOrigins: string[],
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly reservations?: {
      taskBrowser: TaskBrowserStore;
      runs: DuetRunStore;
      lock: ConversationBindingLock;
    },
  ) {}

  async initialize(taskId: string, policyFile: string): Promise<TaskInteractionPolicyV1> {
    const policy = TaskInteractionPolicyV1Schema.parse(
      JSON.parse(await readFile(policyFile, 'utf8')),
    );
    if (policy.taskId !== taskId)
      throw new ChatbridgeError(
        'Interaction policy task ID does not match command task',
        'INTERACTION_POLICY_TASK_MISMATCH',
      );
    await this.policies.setBeforeLock(policy);
    return policy;
  }

  async requireProvider(taskId: string, provider: 'CODEX_BROWSER' | 'PLAYWRIGHT_CLI') {
    const policy = await this.policies.read(taskId);
    if (!policy) return undefined;
    if (policy.browserControlProvider !== provider)
      throw new ChatbridgeError(
        `Task selected ${policy.browserControlProvider}; ${provider} is unavailable for this task`,
        'BROWSER_PROVIDER_MISMATCH',
      );
    return policy;
  }

  async prepareCodexBrowser(
    taskId: string,
    messageFile: string,
    identity: { kind: 'DISCUSSION' | 'PLANNER' | 'REVIEWER'; iteration: number; round?: number },
    conversationUrl?: string,
  ): Promise<CodexBrowserControlV1> {
    const policy = await this.requireProvider(taskId, 'CODEX_BROWSER');
    if (!policy)
      throw new ChatbridgeError(
        'Codex Browser requires an explicit task interaction policy',
        'INTERACTION_POLICY_REQUIRED',
      );
    await this.policies.lock(taskId);
    const existing = await this.codexBrowser.read(taskId);
    if (existing?.operation.state === 'OUTCOME_UNKNOWN')
      throw new ChatbridgeError(
        'Previous Codex Browser send outcome is unknown; automatic resend is forbidden',
        'CODEX_BROWSER_RESEND_FORBIDDEN',
      );
    const content = await readFile(messageFile, 'utf8');
    const outboundSha256 = sha256(content);
    const operationId = sha256(JSON.stringify({ taskId, ...identity, outboundSha256 }));
    if (existing?.operation.state === 'PREPARED' && existing.operation.operationId === operationId)
      return existing;
    if (existing?.operation.state === 'PREPARED')
      throw new ChatbridgeError(
        'A different Codex Browser operation is already prepared',
        'CODEX_BROWSER_OPERATION_PENDING',
      );
    if (existing?.operation.state === 'ATTEMPTED')
      throw new ChatbridgeError(
        'Previous Codex Browser send was attempted; automatic resend is forbidden',
        'CODEX_BROWSER_RESEND_FORBIDDEN',
      );
    if (existing?.operation.state === 'CONFIRMED')
      throw new ChatbridgeError(
        'Confirmed Codex Browser operation is waiting for a response',
        'CODEX_BROWSER_RESPONSE_PENDING',
      );
    const urls = new ConversationUrlPolicy(this.allowedOrigins);
    const explicit = conversationUrl ? urls.canonicalizeStable(conversationUrl) : undefined;
    const existingUrl = existing?.conversationUrl
      ? urls.canonicalizeStable(existing.conversationUrl)
      : undefined;
    if (existingUrl && explicit && existingUrl !== explicit)
      throw new ChatbridgeError(
        'Explicit conversation URL conflicts with the durable Codex Browser binding',
        'CHATGPT_CONVERSATION_BINDING_CONFLICT',
      );
    const canonical = existingUrl ?? explicit;
    const checkpoint = {
      version: 1 as const,
      taskId,
      provider: 'CODEX_BROWSER' as const,
      ...(canonical ? { conversationUrl: canonical } : {}),
      operation: {
        operationId,
        ...identity,
        outboundSha256,
        state: 'PREPARED' as const,
        preparedAt: this.now(),
      },
    };
    const persist = async () => {
      if (canonical && this.reservations) {
        const reservations = new ConversationReservationService(
          this.reservations.taskBrowser,
          { getState: async (id) => (await this.reservations!.runs.read(id))?.state },
          urls,
          this.codexBrowser,
        );
        await reservations.assertTaskExists(taskId);
        await reservations.assertAvailable(taskId, canonical, Boolean(existing?.conversationUrl));
      }
      await this.codexBrowser.write(checkpoint);
    };
    if (this.reservations) await this.reservations.lock.withLock(persist);
    else await persist();
    return checkpoint;
  }

  async markCodexBrowserAttempted(taskId: string): Promise<CodexBrowserControlV1> {
    const policy = await this.requireProvider(taskId, 'CODEX_BROWSER');
    if (!policy)
      throw new ChatbridgeError(
        'Codex Browser requires an explicit task interaction policy',
        'INTERACTION_POLICY_REQUIRED',
      );
    const current = await this.codexBrowser.read(taskId);
    if (!current || current.operation.state !== 'PREPARED')
      throw new ChatbridgeError(
        'No prepared Codex Browser operation exists',
        'CODEX_BROWSER_OPERATION_MISSING',
      );
    const attempted = {
      ...current,
      operation: { ...current.operation, state: 'ATTEMPTED' as const },
    };
    await this.codexBrowser.write(attempted);
    return attempted;
  }

  async completeCodexBrowser(
    taskId: string,
    outcome: 'CONFIRMED' | 'OUTCOME_UNKNOWN',
    conversationUrl?: string,
  ): Promise<CodexBrowserControlV1> {
    const policy = await this.requireProvider(taskId, 'CODEX_BROWSER');
    if (!policy)
      throw new ChatbridgeError(
        'Codex Browser requires an explicit task interaction policy',
        'INTERACTION_POLICY_REQUIRED',
      );
    const complete = async () => {
      const current = await this.codexBrowser.read(taskId);
      if (!current || current.operation.state !== 'ATTEMPTED')
        throw new ChatbridgeError(
          'No attempted Codex Browser operation exists',
          'CODEX_BROWSER_OPERATION_MISSING',
        );
      const urls = new ConversationUrlPolicy(this.allowedOrigins);
      const canonical = conversationUrl
        ? urls.canonicalizeStable(conversationUrl)
        : current.conversationUrl;
      if (outcome === 'CONFIRMED' && !canonical)
        throw new ChatbridgeError(
          'Confirmed Codex Browser send requires exact conversation identity',
          'CHATGPT_CONVERSATION_IDENTITY_REQUIRED',
        );
      if (current.conversationUrl && canonical && current.conversationUrl !== canonical)
        throw new ChatbridgeError(
          'Codex Browser conversation identity changed',
          'CHATGPT_CONVERSATION_UNAVAILABLE',
        );
      if (canonical && this.reservations) {
        const reservations = new ConversationReservationService(
          this.reservations.taskBrowser,
          { getState: async (id) => (await this.reservations!.runs.read(id))?.state },
          urls,
          this.codexBrowser,
        );
        await reservations.assertTaskExists(taskId);
        await reservations.assertAvailable(taskId, canonical, Boolean(current.conversationUrl));
      }
      const completed = {
        ...current,
        ...(canonical ? { conversationUrl: canonical } : {}),
        operation: { ...current.operation, state: outcome, completedAt: this.now() },
      };
      await this.codexBrowser.write(completed);
      return completed;
    };
    return this.reservations ? this.reservations.lock.withLock(complete) : complete();
  }

  async recordCodexBrowserResponse(
    taskId: string,
    responseFile: string,
    conversationUrl?: string,
  ): Promise<CodexBrowserControlV1> {
    const policy = await this.requireProvider(taskId, 'CODEX_BROWSER');
    if (!policy)
      throw new ChatbridgeError(
        'Codex Browser requires an explicit task interaction policy',
        'INTERACTION_POLICY_REQUIRED',
      );
    const current = await this.codexBrowser.read(taskId);
    if (!current || current.operation.state !== 'CONFIRMED')
      throw new ChatbridgeError(
        'Codex Browser response requires a confirmed send',
        'CODEX_BROWSER_SEND_NOT_CONFIRMED',
      );
    const canonical = conversationUrl
      ? new ConversationUrlPolicy(this.allowedOrigins).canonicalizeStable(conversationUrl)
      : undefined;
    if (!canonical || canonical !== current.conversationUrl)
      throw new ChatbridgeError(
        'Codex Browser receive requires the exact durable conversation URL',
        'CHATGPT_CONVERSATION_UNAVAILABLE',
      );
    const response = await readFile(responseFile, 'utf8');
    const inboundSha256 = sha256(response);
    if (current.operation.inboundSha256 && current.operation.inboundSha256 !== inboundSha256)
      throw new ChatbridgeError(
        'Codex Browser response evidence already exists with different content',
        'CODEX_BROWSER_RESPONSE_IMMUTABLE',
      );
    await this.codexBrowser.createResponseArtifact(taskId, current.operation.operationId, response);
    const updated = {
      ...current,
      operation: {
        ...current.operation,
        state: 'RESPONDED' as const,
        inboundSha256,
      },
    };
    await this.codexBrowser.write(updated);
    return updated;
  }

  async assertCodexBrowserInbound(taskId: string, responseFile: string): Promise<void> {
    const policy = await this.policies.read(taskId);
    if (!policy || policy.browserControlProvider !== 'CODEX_BROWSER') return;
    const current = await this.codexBrowser.read(taskId);
    const actual = sha256(await readFile(responseFile, 'utf8'));
    if (
      !current ||
      current.operation.state !== 'RESPONDED' ||
      current.operation.inboundSha256 !== actual
    )
      throw new ChatbridgeError(
        'Lifecycle input does not match the recorded Codex Browser response',
        'CODEX_BROWSER_RESPONSE_MISMATCH',
      );
  }
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
