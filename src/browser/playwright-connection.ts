import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { BrowserConnection } from './browser-connection.js';
import { ChatbridgeError } from '../core/errors.js';

export class PlaywrightConnection implements BrowserConnection {
  private browser: Browser | undefined;
  constructor(private readonly port: number) {}
  async connect(): Promise<BrowserContext> {
    try {
      this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.port}`);
    } catch {
      throw new ChatbridgeError(
        'Managed browser is not reachable. Run `chatbridge browser open` first.',
        'BROWSER_OFFLINE',
      );
    }
    const context = this.browser.contexts()[0];
    if (!context)
      throw new ChatbridgeError('Managed browser has no context', 'BROWSER_CONTEXT_MISSING');
    return context;
  }
  async close() {
    this.browser =
      undefined; /* Process exit drops CDP transport; never close the managed browser. */
  }
}
