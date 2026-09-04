import { readFile } from 'node:fs/promises';
import { TaskIdSchema } from '../core/domain.js';
import { ChatbridgeError } from '../core/errors.js';
import type { BrowserAutomationSession } from '../browser/browser-automation-session.js';
import { ConversationBindingLock } from '../browser/conversation-binding-lock.js';
import {
  ConversationReservationService,
  type TaskActivityResolver,
} from '../browser/conversation-reservation.js';
import { ConversationUrlPolicy } from '../browser/conversation-url.js';
import { TaskBrowserStore } from '../browser/task-browser-store.js';
import { CodexBrowserControlStore } from '../duet/codex-browser-control-store.js';
import { TaskInteractionPolicyStore } from '../duet/interaction-policy-store.js';
import { TaskOperationLock } from '../duet/task-operation-lock.js';
import { sha256 } from '../duet/task-spec.js';
import { LocalPlaywrightProofStore, type PlaywrightProof } from './playwright-proof.js';

export type LocalOutbound = {
  content: string;
  kind: 'DISCUSSION' | 'PLANNER' | 'REVIEWER';
  iteration: number;
  round?: number;
};
export type LocalControlSelection = { round?: number; supplement?: boolean };
export interface LocalPlaywrightDependencies {
  root: string;
  activity: TaskActivityResolver;
  /** Revalidate the persisted LOCAL control and live snapshot under the task lock. */
  outbound(taskId: string, selection: LocalControlSelection): Promise<LocalOutbound>;
  completedControl?: (record: PlaywrightProof) => Promise<boolean>;
  connect(url: string): Promise<{
    adapter: BrowserAutomationSession;
    selection: { conversationUrl: string };
    connection: { close(): Promise<void> };
  }>;
}

/** Explicit LOCAL transport. An attempted send is never retried, including after a crash. */
export class LocalPlaywrightTransport {
  private readonly proof: LocalPlaywrightProofStore;
  private readonly bindings: TaskBrowserStore;
  private readonly urls = new ConversationUrlPolicy(['https://chatgpt.com']);
  constructor(private readonly dependencies: LocalPlaywrightDependencies) {
    this.proof = new LocalPlaywrightProofStore(dependencies.root);
    this.bindings = new TaskBrowserStore(dependencies.root);
  }
  private reservations() {
    return new ConversationReservationService(
      this.bindings,
      this.dependencies.activity,
      this.urls,
      new CodexBrowserControlStore(this.dependencies.root),
    );
  }
  private async policy(taskId: string) {
    const policies = new TaskInteractionPolicyStore(this.dependencies.root);
    const policy = await policies.read(taskId);
    if (policy?.browserControlProvider !== 'PLAYWRIGHT_CLI')
      throw new ChatbridgeError(
        'LOCAL transport requires selected PLAYWRIGHT_CLI',
        'BROWSER_PROVIDER_MISMATCH',
      );
    await policies.lock(taskId);
  }
  private locked<T>(taskId: string, operation: () => Promise<T>) {
    return new ConversationBindingLock(this.dependencies.root).withLock(() =>
      new TaskOperationLock(this.dependencies.root).withLock(taskId, operation),
    );
  }
  async send(taskInput: string, selection: LocalControlSelection = {}, conversationUrl?: string) {
    const taskId = TaskIdSchema.parse(taskInput);
    return this.locked(taskId, async () => {
      await this.policy(taskId);
      const previous = await this.proof.read(taskId);
      if (previous?.operation.state === 'ATTEMPTED')
        throw new ChatbridgeError(
          'Send may have occurred; inspect evidence, never resend automatically',
          'LOCAL_PLAYWRIGHT_RESEND_FORBIDDEN',
        );
      const outbound = await this.dependencies.outbound(taskId, selection);
      if (!outbound.content.trim() || Buffer.byteLength(outbound.content, 'utf8') > 8192)
        throw new ChatbridgeError('Invalid bounded LOCAL control', 'C2C_PAYLOAD_TOO_LARGE');
      const content = outbound.content;
      const identity = {
        kind: outbound.kind,
        iteration: outbound.iteration,
        ...(outbound.round === undefined ? {} : { round: outbound.round }),
      };
      const outboundSha256 = sha256(content);
      const operationId = sha256(JSON.stringify({ taskId, ...identity, outboundSha256 }));
      const existing = await this.bindings.read(taskId);
      const target = conversationUrl
        ? this.urls.canonicalizeStable(conversationUrl)
        : existing?.conversation.url;
      if (!target)
        throw new ChatbridgeError(
          'LOCAL Playwright first send requires an explicit stable conversation URL',
          'CHATGPT_CONVERSATION_REQUIRED',
        );
      this.urls.canonicalizeStable(target);
      if (existing && existing.conversation.url !== target)
        throw new ChatbridgeError(
          'Task conversation is immutable',
          'CHATGPT_CONVERSATION_BINDING_CONFLICT',
        );
      if (!previous && existing?.pendingSend)
        throw new ChatbridgeError(
          'Legacy pending marker cannot become LOCAL proof',
          'LOCAL_TRANSPORT_PROOF_UNAVAILABLE',
        );
      if (previous && previous.conversationUrl !== target)
        throw new ChatbridgeError('Proof conversation mismatch', 'LOCAL_PLAYWRIGHT_PROOF_INVALID');
      if (previous?.operation.operationId === operationId) return previous; // Read-only retry, no send.
      if (
        previous?.operation.state === 'CONFIRMED' &&
        !(await this.dependencies.completedControl?.(previous))
      )
        throw new ChatbridgeError(
          'Previous response is not durably accepted',
          'LOCAL_PLAYWRIGHT_RESPONSE_PENDING',
        );
      await this.reservations().assertTaskExists(taskId);
      await this.reservations().assertAvailable(taskId, target, true);
      const connected = await this.dependencies.connect(target);
      try {
        if (this.urls.canonicalizeStable(connected.selection.conversationUrl) !== target)
          throw new ChatbridgeError(
            'Browser selected a different conversation',
            'CHATGPT_CONVERSATION_UNAVAILABLE',
          );
        if (!(await connected.adapter.isLoggedIn()))
          throw new ChatbridgeError('ChatGPT login required', 'CHATGPT_LOGIN_REQUIRED');
        // Reserve the conversation before the durable intent and external side effect.
        const conversation = existing?.conversation ?? {
          url: target,
          boundAt: new Date().toISOString(),
        };
        await this.bindings.write({ version: 1, taskId, conversation });
        await this.proof.artifact(taskId, operationId, 'request', content);
        const attempted: PlaywrightProof = {
          version: 1,
          taskId,
          provider: 'PLAYWRIGHT_CLI',
          conversationUrl: target,
          operation: {
            ...identity,
            operationId,
            outboundSha256,
            state: 'ATTEMPTED',
            preparedAt: new Date().toISOString(),
          },
        };
        await this.proof.write(attempted);
        // From this point any failure remains ATTEMPTED. No automatic retry or marker promotion.
        const marker = await connected.adapter.sendMessage(content);
        if (this.urls.canonicalizeStable(marker.conversationUrl) !== target)
          throw new ChatbridgeError(
            'Confirmed send changed conversation; do not resend',
            'SEND_CHECKPOINT_PERSIST_FAILED',
          );
        const confirmed: PlaywrightProof = {
          ...attempted,
          marker,
          operation: {
            ...attempted.operation,
            state: 'CONFIRMED',
            completedAt: new Date().toISOString(),
          },
        };
        await this.bindings.write({
          version: 1,
          taskId,
          conversation,
          pendingSend: {
            outgoingUserMessageId: marker.outgoingUserMessageId,
            ...(marker.previousAssistantMessageId
              ? { previousAssistantMessageId: marker.previousAssistantMessageId }
              : {}),
            sentAt: confirmed.operation.completedAt!,
          },
        });
        await this.proof.write(confirmed);
        return confirmed;
      } finally {
        await connected.connection.close();
      }
    });
  }
  async wait(taskInput: string, timeoutMs = 120000) {
    const taskId = TaskIdSchema.parse(taskInput);
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000)
      throw new ChatbridgeError(
        'Wait timeout must be 1..120000 ms',
        'LOCAL_PLAYWRIGHT_TIMEOUT_INVALID',
      );
    return this.locked(taskId, async () => {
      await this.policy(taskId);
      const proof = await this.proof.read(taskId);
      if (!proof?.marker || proof.operation.state === 'ATTEMPTED')
        throw new ChatbridgeError(
          'No exact confirmed Playwright send',
          'LOCAL_TRANSPORT_PROOF_UNAVAILABLE',
        );
      if (proof.operation.state === 'RESPONDED') return this.proof.response(proof);
      await this.reservations().assertTaskExists(taskId);
      await this.reservations().assertAvailable(taskId, proof.conversationUrl, true);
      // Recover publication-before-checkpoint crashes without another browser read.
      let published: string | undefined;
      try {
        published = await readFile(
          this.proof.artifactPath(taskId, proof.operation.operationId, 'response'),
          'utf8',
        );
      } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error;
      }
      const complete = async (response: string) => {
        const limit = proof.operation.kind === 'DISCUSSION' ? 8192 : 64 * 1024;
        if (!response.trim() || Buffer.byteLength(response, 'utf8') > limit)
          throw new ChatbridgeError(
            'Browser response exceeds bounds',
            'LOCAL_PLAYWRIGHT_RESPONSE_INVALID',
          );
        await this.proof.artifact(taskId, proof.operation.operationId, 'response', response);
        await this.proof.write({
          ...proof,
          operation: { ...proof.operation, state: 'RESPONDED', inboundSha256: sha256(response) },
        });
        return response;
      };
      if (published !== undefined) return complete(published);
      const connected = await this.dependencies.connect(proof.conversationUrl);
      try {
        if (
          this.urls.canonicalizeStable(connected.selection.conversationUrl) !==
          proof.conversationUrl
        )
          throw new ChatbridgeError(
            'Browser selected a different conversation',
            'CHATGPT_CONVERSATION_UNAVAILABLE',
          );
        const response = await connected.adapter.waitForAssistantMessage({
          checkpoint: {
            conversationUrl: proof.marker.conversationUrl,
            outgoingUserMessageId: proof.marker.outgoingUserMessageId,
            ...(proof.marker.previousAssistantMessageId
              ? { previousAssistantMessageId: proof.marker.previousAssistantMessageId }
              : {}),
          },
          timeoutMs,
        });
        return await complete(response);
      } finally {
        await connected.connection.close();
      }
    });
  }
}
