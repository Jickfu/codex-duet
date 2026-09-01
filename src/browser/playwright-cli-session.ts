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
    const result = await this.runner.run(
      [`--session=${this.session}`, 'run-code', buildCliOperation(op, this.url, this.origins)],
      timeout,
    );
    const match = result.stdout.match(/CHATBRIDGE_RESULT_([A-Za-z0-9+/=]+)/);
    if (!match)
      throw new ChatbridgeError(
        'Playwright CLI returned no structured bridge result',
        'CLI_RESULT_MISSING',
      );
    try {
      return JSON.parse(Buffer.from(match[1]!, 'base64').toString('utf8')) as {
        ok?: boolean;
        value?: unknown;
      };
    } catch {
      throw new ChatbridgeError(
        'Playwright CLI returned an invalid structured result',
        'CLI_RESULT_INVALID',
      );
    }
  }
}
