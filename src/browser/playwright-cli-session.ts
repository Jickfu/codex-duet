import { randomBytes } from 'node:crypto';
import { BridgeTimeoutError, ChatbridgeError } from '../core/errors.js';
import type { BrowserAutomationSession } from './browser-automation-session.js';
import { buildCliOperation } from './chatgpt-rules.js';
import type { WaitOptions } from './chatgpt-adapter.js';
import type { PlaywrightCliRunnerLike } from './playwright-cli-runner.js';

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
  async sendMessage(message: string) {
    if (!message.trim()) throw new ChatbridgeError('Message must not be empty', 'EMPTY_MESSAGE');
    return Number((await this.operation({ kind: 'send', message })).value);
  }
  async waitForAssistantMessage(options: WaitOptions = {}) {
    if (options.afterCount === undefined)
      throw new ChatbridgeError(
        'CLI wait requires the send checkpoint assistant count',
        'MISSING_ASSISTANT_COUNT',
      );
    try {
      return String(
        (
          await this.operation(
            {
              kind: 'wait',
              afterCount: options.afterCount,
              timeoutMs: options.timeoutMs ?? this.timeoutMs,
            },
            (options.timeoutMs ?? this.timeoutMs) + 2000,
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
  private async operation(op: Parameters<typeof buildCliOperation>[0], timeout?: number) {
    const nonce = randomBytes(16).toString('hex');
    const result = await this.runner.run(
      [
        `--session=${this.session}`,
        'run-code',
        buildCliOperation(op, this.url, this.origins, nonce),
      ],
      timeout,
    );
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
    if (code === 'ORIGIN_DENIED')
      throw new ChatbridgeError('Page navigated outside the allowlisted origin', code);
    if (code === 'BRIDGE_TIMEOUT') throw new BridgeTimeoutError('Browser operation timed out');
    if (code === 'CHATGPT_DOCUMENT_MISSING')
      throw new ChatbridgeError('ChatGPT document root is unavailable', code);
    throw new ChatbridgeError('Invalid structured bridge error', 'CLI_RESULT_INVALID');
  }
}
