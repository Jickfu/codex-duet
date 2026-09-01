import type { BrowserContext, Locator, Page } from 'playwright';
import { BridgeTimeoutError, ChatbridgeError } from '../core/errors.js';

export interface WaitOptions {
  afterCount?: number;
  timeoutMs?: number;
}
export interface ChatGPTWebAdapter {
  connect(): Promise<void>;
  ensureConversation(): Promise<void>;
  isLoggedIn(): Promise<boolean>;
  sendMessage(message: string): Promise<number>;
  waitForAssistantMessage(options?: WaitOptions): Promise<string>;
}
const ASSISTANT_SELECTOR =
  '[data-message-author-role="assistant"], article:has([data-testid*="assistant"])';
export class PlaywrightChatGPTWebAdapter implements ChatGPTWebAdapter {
  private page?: Page;
  constructor(
    private readonly context: BrowserContext,
    private readonly url: string,
    private readonly defaultTimeout = 120_000,
    private readonly debug = false,
  ) {}
  private diagnostic(message: string) {
    if (this.debug) console.error(`[DEBUG] ${message}`);
  }
  async connect() {
    const pages = this.context.pages();
    this.page =
      pages.find((p) => p.url().includes('chatgpt.com')) ??
      pages.at(-1) ??
      (await this.context.newPage());
    await this.ensureConversation();
  }
  async ensureConversation() {
    const p = this.requiredPage();
    if (this.url !== 'about:blank' && !p.url().includes('chatgpt.com')) await p.goto(this.url);
    await p.waitForLoadState('domcontentloaded');
  }
  private requiredPage() {
    if (!this.page) throw new ChatbridgeError('Adapter is not connected', 'NOT_CONNECTED');
    return this.page;
  }
  private composer(): Locator {
    const p = this.requiredPage();
    return p
      .locator(
        '#prompt-textarea, [data-testid="prompt-textarea"], textarea[placeholder*="Message"], [contenteditable="true"][role="textbox"]',
      )
      .first();
  }
  private messages() {
    return this.requiredPage().locator(ASSISTANT_SELECTOR);
  }
  async isLoggedIn() {
    try {
      await this.composer().waitFor({ state: 'visible', timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }
  async sendMessage(message: string): Promise<number> {
    if (!message.trim()) throw new ChatbridgeError('Message must not be empty', 'EMPTY_MESSAGE');
    const before = await this.messages().count();
    const composer = this.composer();
    this.diagnostic(`assistant baseline=${before}`);
    await composer.waitFor({ state: 'visible', timeout: 10_000 });
    await composer.fill(message);
    const send = this.requiredPage()
      .getByRole('button', { name: /send|发送/i })
      .or(this.requiredPage().locator('[data-testid="send-button"]'))
      .first();
    if (await send.isVisible().catch(() => false)) await send.click();
    else await composer.press('Enter');
    return before;
  }
  async waitForAssistantMessage(options: WaitOptions = {}): Promise<string> {
    const after = options.afterCount ?? (await this.messages().count());
    const timeout = options.timeoutMs ?? this.defaultTimeout;
    this.diagnostic(`waiting for assistant index=${after}, timeout=${timeout}ms`);
    const p = this.requiredPage();
    const messages = this.messages();
    try {
      await p.waitForFunction(
        ({ selector, count }) => document.querySelectorAll(selector).length > count,
        { selector: ASSISTANT_SELECTOR, count: after },
        { timeout },
      );
      const target = messages.nth(after);
      await target.waitFor({ state: 'visible', timeout });
      await p.waitForFunction(
        ({ index, selector }) => {
          const items = document.querySelectorAll(selector);
          const el = items[index];
          if (!el) return false;
          const streaming =
            el.getAttribute('data-message-streaming') === 'true' ||
            el.querySelector('[data-streaming="true"], .result-streaming');
          const stop = document.querySelector(
            '[data-testid="stop-button"], button[aria-label*="Stop"], button[aria-label*="停止"]',
          );
          return !streaming && !stop && (el.textContent?.trim().length ?? 0) > 0;
        },
        { index: after, selector: ASSISTANT_SELECTOR },
        { timeout, polling: 100 },
      );
      const text = (await target.innerText()).trim();
      this.diagnostic(`assistant response complete, characters=${text.length}`);
      return text;
    } catch (error) {
      throw new BridgeTimeoutError(
        `Timed out after ${timeout}ms waiting for a complete assistant response: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
