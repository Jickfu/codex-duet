import { chromium, type Browser, type BrowserContext } from 'playwright';
import { ChatbridgeError } from '../core/errors.js';
import type { BrowserConnection } from './browser-connection.js';

export class ExistingBrowserConnection implements BrowserConnection {
  private browser: Browser | undefined;
  constructor(
    private readonly endpoint: string,
    private readonly connector: typeof chromium.connectOverCDP = chromium.connectOverCDP.bind(
      chromium,
    ),
  ) {}
  async connect(): Promise<BrowserContext> {
    try {
      this.browser = await this.connector(this.endpoint, { noDefaults: true, timeout: 3000 });
    } catch {
      throw new ChatbridgeError(
        `Existing browser is not attachable at ${this.endpoint}`,
        'EXISTING_BROWSER_UNAVAILABLE',
      );
    }
    const context = this.browser.contexts()[0];
    if (!context)
      throw new ChatbridgeError(
        'Existing browser exposes no default context',
        'BROWSER_CONTEXT_MISSING',
      );
    return context;
  }
  async close() {
    this.browser = undefined;
  }
}
