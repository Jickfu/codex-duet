import type { BrowserAutomationSession } from './browser-automation-session.js';
import type { BrowserConnection } from './browser-connection.js';
import { PlaywrightChatGPTWebAdapter, type WaitOptions } from './chatgpt-adapter.js';

export class LibraryChatGPTSession implements BrowserAutomationSession {
  private adapter: PlaywrightChatGPTWebAdapter | undefined;
  constructor(
    private readonly connection: BrowserConnection,
    private readonly url: string,
    private readonly origins: readonly string[],
    private readonly timeoutMs = 120_000,
    private readonly debug = false,
  ) {}
  async connect() {
    this.adapter = new PlaywrightChatGPTWebAdapter(
      await this.connection.connect(),
      this.url,
      this.timeoutMs,
      this.debug,
      this.origins,
    );
    await this.adapter.connect();
  }
  async ensureConversation() {
    await this.required().ensureConversation();
  }
  async isLoggedIn() {
    return this.required().isLoggedIn();
  }
  async sendMessage(message: string) {
    return this.required().sendMessage(message);
  }
  async waitForAssistantMessage(options?: WaitOptions) {
    return this.required().waitForAssistantMessage(options);
  }
  async close() {
    await this.connection.close();
  }
  private required() {
    if (!this.adapter) throw new Error('Library browser session is not connected');
    return this.adapter;
  }
}
