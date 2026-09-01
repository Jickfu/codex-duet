import { randomBytes } from 'node:crypto';
import { BridgeTimeoutError, ChatbridgeError } from '../core/errors.js';
import type {
  BrowserAutomationSession,
  SendMarker,
  WaitOptions,
} from './browser-automation-session.js';
import { buildCliOperation, type CliOperation } from './chatgpt-rules.js';
import type { PlaywrightCliRunnerLike } from './playwright-cli-runner.js';

interface SendPreparation {
  conversationUrl: string;
  previousUserMessageId?: string;
  previousAssistantMessageId?: string;
}

export class PlaywrightCliChatGPTSession implements BrowserAutomationSession {
  constructor(
    private readonly runner: PlaywrightCliRunnerLike,
    private readonly session: string,
    private readonly url: string,
    private readonly origins: readonly string[],
    private readonly timeoutMs = 120_000,
  ) {}
  async connect() {
    await this.ensureConversation();
  }
  async ensureConversation() {
    await this.operation({ kind: 'ensure' });
  }
  async isLoggedIn() {
    return Boolean((await this.operation({ kind: 'login' })).value);
  }
  async sendMessage(message: string): Promise<SendMarker> {
    if (!message.trim()) throw new ChatbridgeError('Message must not be empty', 'EMPTY_MESSAGE');
    const prepared = (await this.operation({ kind: 'prepare' })).value as SendPreparation;
    const commit: CliOperation = { kind: 'commit', message, ...prepared };
    try {
      return (await this.operation(commit, 30_000, 'send')).value as SendMarker;
    } catch (error) {
      if (!(error instanceof ChatbridgeError) || error.code !== 'PLAYWRIGHT_CLI_TIMEOUT')
        throw error;
      const recovered = (
        await this.operation(
          {
            kind: 'recover',
            conversationUrl: prepared.conversationUrl,
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
      CHATGPT_TAB_AMBIGUOUS: 'Multiple ChatGPT tabs are available and no current tab is defined',
      CHATGPT_CONVERSATION_NOT_FOUND: 'The checkpoint conversation tab is not available',
    };
    if (code === 'BRIDGE_TIMEOUT') throw new BridgeTimeoutError('Browser operation timed out');
    if (code in messages) throw new ChatbridgeError(messages[code]!, code);
    throw new ChatbridgeError('Invalid structured bridge error', 'CLI_RESULT_INVALID');
  }
}
