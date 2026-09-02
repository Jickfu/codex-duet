import { randomBytes } from 'node:crypto';
import { BridgeTimeoutError, ChatbridgeError } from '../core/errors.js';
import type {
  BrowserAutomationSession,
  BrowserConnectOptions,
  SendMarker,
  WaitOptions,
} from './browser-automation-session.js';
import { buildCliOperation, type CliOperation } from './chatgpt-rules.js';
import type { PlaywrightCliRunnerLike } from './playwright-cli-runner.js';
import { ConversationUrlPolicy } from './conversation-url.js';

interface SendPreparation {
  conversationUrl: string;
  previousUserMessageId?: string;
  previousAssistantMessageId?: string;
}

const ambiguousCommitTransportFailures = new Set([
  'PLAYWRIGHT_CLI_TIMEOUT',
  'PLAYWRIGHT_CLI_FAILED',
  'PLAYWRIGHT_CLI_SESSION_LOST',
  'CLI_RESULT_MISSING',
  'CLI_RESULT_INVALID',
  'SEND_OBSERVER_FAILED',
]);

export function isAmbiguousCommitTransportFailure(error: unknown): error is ChatbridgeError {
  return error instanceof ChatbridgeError && ambiguousCommitTransportFailures.has(error.code);
}

export class PlaywrightCliChatGPTSession implements BrowserAutomationSession {
  private selectedConversationUrl?: string;
  private strictConversationTarget = false;
  private readonly conversationUrls: ConversationUrlPolicy;
  constructor(
    private readonly runner: PlaywrightCliRunnerLike,
    private readonly session: string,
    private readonly url: string,
    private readonly origins: readonly string[],
    private readonly timeoutMs = 120_000,
  ) {
    this.conversationUrls = new ConversationUrlPolicy(origins);
  }
  async connect(options: BrowserConnectOptions = {}) {
    const target = options.conversationUrl
      ? this.conversationUrls.canonicalize(options.conversationUrl)
      : undefined;
    const result = await this.operation({
      kind: 'ensure',
      ...(target ? { conversationUrl: target } : {}),
    });
    const selection = result.value as { conversationUrl: string };
    this.selectedConversationUrl = this.conversationUrls.canonicalize(selection.conversationUrl);
    this.strictConversationTarget = Boolean(target);
    return { conversationUrl: this.selectedConversationUrl };
  }
  async ensureConversation() {
    const result = await this.operation({
      kind: 'ensure',
      ...(this.selectedConversationUrl ? { conversationUrl: this.selectedConversationUrl } : {}),
    });
    const selection = result.value as { conversationUrl?: string } | undefined;
    if (selection?.conversationUrl) this.selectedConversationUrl = selection.conversationUrl;
  }
  async isLoggedIn() {
    return Boolean(
      (
        await this.operation({
          kind: 'login',
          ...(this.selectedConversationUrl
            ? { conversationUrl: this.selectedConversationUrl }
            : {}),
        })
      ).value,
    );
  }
  async sendMessage(message: string): Promise<SendMarker> {
    if (!message.trim()) throw new ChatbridgeError('Message must not be empty', 'EMPTY_MESSAGE');
    const prepared = (
      await this.operation({
        kind: 'prepare',
        ...(this.selectedConversationUrl ? { conversationUrl: this.selectedConversationUrl } : {}),
      })
    ).value as SendPreparation;
    const commit: CliOperation = { kind: 'commit', message, ...prepared };
    try {
      return (await this.operation(commit, 30_000, 'send')).value as SendMarker;
    } catch (error) {
      if (!isAmbiguousCommitTransportFailure(error)) throw error;
      const recovered = await this.recoverSend(prepared).catch(() => undefined);
      if (recovered) return recovered as SendMarker;
      throw new ChatbridgeError(
        'Send may have had a side effect, but no new user message identity could be confirmed; do not retry automatically',
        'SEND_OUTCOME_UNKNOWN',
      );
    }
  }
  async waitForAssistantMessage(options: WaitOptions) {
    const timeout = options.timeoutMs ?? this.timeoutMs;
    try {
      return String(
        (
          await this.operation(
            {
              kind: 'wait',
              conversationUrl: options.checkpoint.conversationUrl,
              outgoingUserMessageId: options.checkpoint.outgoingUserMessageId,
              timeoutMs: timeout,
            },
            timeout + 5000,
          )
        ).value,
      );
    } catch (error) {
      if (error instanceof ChatbridgeError && error.code === 'PLAYWRIGHT_CLI_TIMEOUT')
        throw new BridgeTimeoutError(`Timed out waiting for a complete assistant response`);
      throw error;
    }
  }
  async close() {
    await this.runner.run([`--session=${this.session}`, 'detach'], 5000);
  }
  private async recoverSend(prepared: SendPreparation) {
    return (
      await this.operation(
        {
          kind: 'recover',
          conversationUrl: prepared.conversationUrl,
          exactOnly: this.strictConversationTarget,
          ...(prepared.previousUserMessageId
            ? { previousUserMessageId: prepared.previousUserMessageId }
            : {}),
          ...(prepared.previousAssistantMessageId
            ? { previousAssistantMessageId: prepared.previousAssistantMessageId }
            : {}),
        },
        10_000,
        'send-recovery',
      )
    ).value;
  }
  private async operation(op: CliOperation, timeout?: number, phase: string = op.kind) {
    const nonce = randomBytes(16).toString('hex');
    let result;
    try {
      result = await this.runner.run(
        [
          `--session=${this.session}`,
          'run-code',
          buildCliOperation(op, this.url, this.origins, nonce),
        ],
        timeout,
      );
    } catch (error) {
      if (process.env.CHATBRIDGE_DEBUG === '1') {
        const code = error instanceof ChatbridgeError ? error.code : 'UNKNOWN';
        console.error(`[DEBUG] Playwright CLI phase=${phase} category=${code}`);
      }
      throw error;
    }
    const errorMatch = result.stdout.match(new RegExp(`CHATBRIDGE_ERROR_${nonce}_([A-Fa-f0-9]+)`));
    if (errorMatch) {
      try {
        this.throwBridgeError(this.decodeEnvelope(errorMatch[1]!));
      } catch (error) {
        if (error instanceof ChatbridgeError) throw error;
        throw new ChatbridgeError(
          'Playwright CLI returned an invalid structured error',
          'CLI_RESULT_INVALID',
        );
      }
    }
    const match = result.stdout.match(new RegExp(`CHATBRIDGE_RESULT_${nonce}_([A-Fa-f0-9]+)`));
    if (!match)
      throw new ChatbridgeError(
        'Playwright CLI returned no structured bridge result',
        'CLI_RESULT_MISSING',
      );
    try {
      return this.decodeEnvelope(match[1]!) as { ok?: boolean; value?: unknown };
    } catch {
      throw new ChatbridgeError(
        'Playwright CLI returned an invalid structured result',
        'CLI_RESULT_INVALID',
      );
    }
  }
  private decodeEnvelope(encoded: string): unknown {
    const percentEncoded = Buffer.from(encoded, 'hex').toString('ascii');
    return JSON.parse(decodeURIComponent(percentEncoded));
  }
  private throwBridgeError(envelope: unknown): never {
    const code =
      typeof envelope === 'object' && envelope !== null && 'code' in envelope
        ? String(envelope.code)
        : '';
    const messages: Record<string, string> = {
      ORIGIN_DENIED: 'Page navigated outside the allowlisted origin',
      CHATGPT_DOCUMENT_MISSING: 'ChatGPT document root is unavailable',
      CHATGPT_MESSAGE_ID_UNAVAILABLE: 'ChatGPT did not expose a stable message identity',
      CHATGPT_SEND_NOT_READY:
        'Composer was filled, but no deterministic send action became actionable before timeout; no send action was attempted',
      CHATGPT_TAB_AMBIGUOUS: 'Multiple ChatGPT tabs are available and no current tab is defined',
      CHATGPT_CONVERSATION_NOT_FOUND: 'The checkpoint conversation tab is not available',
      CHATGPT_CONVERSATION_UNAVAILABLE: 'The bound ChatGPT conversation is unavailable',
      SEND_OBSERVER_FAILED: 'Send was attempted but its outgoing message identity was not observed',
      SEND_CHECKPOINT_PERSIST_FAILED:
        'Send was confirmed but no stable conversation identity appeared; do not resend automatically',
    };
    if (code === 'BRIDGE_TIMEOUT') throw new BridgeTimeoutError('Browser operation timed out');
    if (code in messages) throw new ChatbridgeError(messages[code]!, code);
    throw new ChatbridgeError('Invalid structured bridge error', 'CLI_RESULT_INVALID');
  }
}
