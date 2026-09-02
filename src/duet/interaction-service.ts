import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ChatbridgeError } from '../core/errors.js';
import { ConversationUrlPolicy } from '../browser/conversation-url.js';
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
    await this.policies.createOrVerify(policy);
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
  ): Promise<CodexBrowserControlV1> {
    const policy = await this.requireProvider(taskId, 'CODEX_BROWSER');
    if (!policy)
      throw new ChatbridgeError(
        'Codex Browser requires an explicit task interaction policy',
        'INTERACTION_POLICY_REQUIRED',
      );
    const existing = await this.codexBrowser.read(taskId);
    if (existing?.operation.state === 'OUTCOME_UNKNOWN')
      throw new ChatbridgeError(
        'Previous Codex Browser send outcome is unknown; automatic resend is forbidden',
        'CODEX_BROWSER_RESEND_FORBIDDEN',
      );
    if (existing?.operation.state === 'PREPARED')
      throw new ChatbridgeError(
        'A Codex Browser operation is already prepared; resolve it before another send',
        'CODEX_BROWSER_OPERATION_PENDING',
      );
    const content = await readFile(messageFile, 'utf8');
    const checkpoint = {
      version: 1 as const,
      taskId,
      provider: 'CODEX_BROWSER' as const,
      ...(existing?.conversationUrl ? { conversationUrl: existing.conversationUrl } : {}),
      operation: {
        ...identity,
        outboundSha256: sha256(content),
        state: 'PREPARED' as const,
        preparedAt: this.now(),
      },
    };
    await this.codexBrowser.write(checkpoint);
    return checkpoint;
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
    const current = await this.codexBrowser.read(taskId);
    if (!current || current.operation.state !== 'PREPARED')
      throw new ChatbridgeError(
        'No prepared Codex Browser operation exists',
        'CODEX_BROWSER_OPERATION_MISSING',
      );
    const canonical = conversationUrl
      ? new ConversationUrlPolicy(this.allowedOrigins).canonicalizeStable(conversationUrl)
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
    const completed = {
      ...current,
      ...(canonical ? { conversationUrl: canonical } : {}),
      operation: { ...current.operation, state: outcome, completedAt: this.now() },
    };
    await this.codexBrowser.write(completed);
    return completed;
  }

  async recordCodexBrowserResponse(
    taskId: string,
    responseFile: string,
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
    const inboundSha256 = sha256(await readFile(responseFile, 'utf8'));
    if (current.operation.inboundSha256 && current.operation.inboundSha256 !== inboundSha256)
      throw new ChatbridgeError(
        'Codex Browser response evidence already exists with different content',
        'CODEX_BROWSER_RESPONSE_IMMUTABLE',
      );
    const updated = {
      ...current,
      operation: {
        ...current.operation,
        inboundSha256,
      },
    };
    await this.codexBrowser.write(updated);
    return updated;
  }
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
