import type { BrowserContext, Locator, Page } from 'playwright';
import { BridgeTimeoutError, ChatbridgeError } from '../core/errors.js';
import { OriginPolicy } from './origin-policy.js';
import {
  CHATGPT_ASSISTANT_SELECTOR,
  CHATGPT_COMPOSER_SELECTOR,
  CHATGPT_SEND_SELECTOR,
  CHATGPT_STOP_SELECTOR,
  CHATGPT_STREAMING_SELECTOR,
} from './chatgpt-rules.js';

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
export class PlaywrightChatGPTWebAdapter implements ChatGPTWebAdapter {
  private page?: Page;
  private readonly originPolicy: OriginPolicy;
  constructor(
    private readonly context: BrowserContext,
    private readonly url: string,
    private readonly defaultTimeout = 120_000,
    private readonly debug = false,
    allowedOrigins: readonly string[] = ['https://chatgpt.com'],
  ) {
    this.originPolicy = new OriginPolicy(allowedOrigins);
  }
  private diagnostic(message: string) {
    if (this.debug) console.error(`[DEBUG] ${message}`);
  }
  async connect() {
    const pages = this.context.pages();
    this.page =
      pages.find((page) => this.originPolicy.allows(page.url())) ?? (await this.context.newPage());
    await this.ensureConversation();
  }
  async ensureConversation() {
    const p = this.requiredPage();
    if (!this.originPolicy.allows(p.url())) await p.goto(this.url);
    await p.waitForLoadState('domcontentloaded');
    this.assertPageAllowed();
  }
  private requiredPage() {
    if (!this.page) throw new ChatbridgeError('Adapter is not connected', 'NOT_CONNECTED');
    return this.page;
  }
  private composer(): Locator {
    this.assertPageAllowed();
    const p = this.requiredPage();
    return p.locator(CHATGPT_COMPOSER_SELECTOR).first();
  }
  private messages() {
    this.assertPageAllowed();
    return this.requiredPage().locator(CHATGPT_ASSISTANT_SELECTOR);
  }
  private assertPageAllowed() {
    this.originPolicy.assertAllowed(this.requiredPage().url());
  }
  async isLoggedIn() {
    this.assertPageAllowed();
    try {
      await this.composer().waitFor({ state: 'visible', timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }
  async sendMessage(message: string): Promise<number> {
    this.assertPageAllowed();
    if (!message.trim()) throw new ChatbridgeError('Message must not be empty', 'EMPTY_MESSAGE');
    return this.withOriginGuard(async () => {
      const before = await this.messages().count();
      const composer = this.composer();
      this.diagnostic(`assistant baseline=${before}`);
      await composer.waitFor({ state: 'visible', timeout: 10_000 });
      await composer.fill(message);
      this.assertPageAllowed();
      const send = this.requiredPage()
        .getByRole('button', { name: /send|发送/i })
        .or(this.requiredPage().locator(CHATGPT_SEND_SELECTOR))
        .first();
      if (await send.isVisible().catch(() => false)) await send.click();
      else await composer.press('Enter');
      this.assertPageAllowed();
      return before;
    });
  }
  async waitForAssistantMessage(options: WaitOptions = {}): Promise<string> {
    this.assertPageAllowed();
    const after = options.afterCount ?? (await this.messages().count());
    const timeout = options.timeoutMs ?? this.defaultTimeout;
    this.diagnostic(`waiting for assistant index=${after}, timeout=${timeout}ms`);
    const p = this.requiredPage();
    const messages = this.messages();
    try {
      return await this.withOriginGuard(async () => {
        await p.waitForFunction(
          ({ selector, count }) => document.querySelectorAll(selector).length > count,
          { selector: CHATGPT_ASSISTANT_SELECTOR, count: after },
          { timeout },
        );
        const target = messages.nth(after);
        await target.waitFor({ state: 'visible', timeout });
        await p.waitForFunction(
          ({ index, selector, streamingSelector, stopSelector }) => {
            const items = document.querySelectorAll(selector);
            const el = items[index];
            if (!el) return false;
            const streaming =
              el.getAttribute('data-message-streaming') === 'true' ||
              el.querySelector(streamingSelector);
            const stop = document.querySelector(stopSelector);
            return !streaming && !stop && (el.textContent?.trim().length ?? 0) > 0;
          },
          {
            index: after,
            selector: CHATGPT_ASSISTANT_SELECTOR,
            streamingSelector: CHATGPT_STREAMING_SELECTOR,
            stopSelector: CHATGPT_STOP_SELECTOR,
          },
          { timeout, polling: 100 },
        );
        const text = (await target.innerText()).trim();
        this.diagnostic(`assistant response complete, characters=${text.length}`);
        return text;
      });
    } catch (error) {
      if (error instanceof ChatbridgeError && error.code === 'ORIGIN_DENIED') throw error;
      if (error instanceof Error && error.message.includes('ORIGIN_DENIED'))
        throw new ChatbridgeError('Page navigated outside the allowlisted origin', 'ORIGIN_DENIED');
      throw new BridgeTimeoutError(
        `Timed out after ${timeout}ms waiting for a complete assistant response: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  private async withOriginGuard<T>(operation: () => Promise<T>): Promise<T> {
    const page = this.requiredPage();
    let rejectNavigation!: (reason: Error) => void;
    const navigation = new Promise<never>((_, reject) => {
      rejectNavigation = reject;
    });
    const listener = (frame: any) => {
      if (frame === page.mainFrame() && !this.originPolicy.allows(frame.url()))
        rejectNavigation(
          new ChatbridgeError('Page navigated outside the allowlisted origin', 'ORIGIN_DENIED'),
        );
    };
    page.on('framenavigated', listener);
    try {
      return await Promise.race([operation(), navigation]);
    } finally {
      page.off('framenavigated', listener);
    }
  }
}
