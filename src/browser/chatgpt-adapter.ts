import type { BrowserContext, Frame, Page } from 'playwright';
import { BridgeTimeoutError, ChatbridgeError } from '../core/errors.js';
import {
  CHATGPT_ASSISTANT_SELECTOR,
  CHATGPT_COMPOSER_SELECTOR,
  CHATGPT_SEND_SELECTOR,
  CHATGPT_STOP_SELECTOR,
  CHATGPT_STREAMING_SELECTOR,
} from './chatgpt-rules.js';
import { OriginPolicy } from './origin-policy.js';

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
    private readonly operationBoundary?: (name: 'before-text-extraction') => Promise<void> | void,
  ) {
    this.originPolicy = new OriginPolicy(allowedOrigins);
  }
  async connect() {
    this.page =
      this.context.pages().find((page) => this.originPolicy.allows(page.url())) ??
      (await this.context.newPage());
    await this.ensureConversation();
  }
  async ensureConversation() {
    const page = this.requiredPage();
    if (!this.originPolicy.allows(page.url())) await page.goto(this.url);
    await page.waitForLoadState('domcontentloaded');
    this.assertPageAllowed();
  }
  async isLoggedIn() {
    const guard = this.guard();
    try {
      const root = await this.root(guard);
      const composer = await guard.run(() => root.$(CHATGPT_COMPOSER_SELECTOR));
      return composer ? await guard.run(() => composer.isVisible()) : false;
    } finally {
      guard.dispose();
    }
  }
  async sendMessage(message: string) {
    if (!message.trim()) throw new ChatbridgeError('Message must not be empty', 'EMPTY_MESSAGE');
    const guard = this.guard();
    try {
      const root = await this.root(guard);
      const before = (await guard.run(() => root.$$(CHATGPT_ASSISTANT_SELECTOR))).length;
      const composer = await this.pollValue(
        guard,
        async () => {
          const item = await guard.run(() => root.$(CHATGPT_COMPOSER_SELECTOR));
          return item && (await guard.run(() => item.isVisible())) ? item : undefined;
        },
        10_000,
        'Composer did not become visible',
      );
      await guard.run(() => composer.fill(message));
      const send = await guard.run(() => root.$(CHATGPT_SEND_SELECTOR));
      if (send && (await guard.run(() => send.isVisible()))) await guard.run(() => send.click());
      else await guard.run(() => composer.press('Enter'));
      this.diagnostic(`assistant baseline=${before}`);
      return before;
    } finally {
      guard.dispose();
    }
  }
  async waitForAssistantMessage(options: WaitOptions = {}) {
    const timeout = options.timeoutMs ?? this.defaultTimeout;
    const guard = this.guard();
    const deadline = Date.now() + timeout;
    try {
      const root = await this.root(guard);
      const initial =
        options.afterCount ?? (await guard.run(() => root.$$(CHATGPT_ASSISTANT_SELECTOR))).length;
      const target = await this.pollValue(
        guard,
        async () => {
          const items = await guard.run(() => root.$$(CHATGPT_ASSISTANT_SELECTOR));
          return items.length > initial ? items[initial] : undefined;
        },
        timeout,
        'Assistant message did not appear',
      );
      await this.pollValue(
        guard,
        async () => ((await guard.run(() => target.isVisible())) ? true : undefined),
        this.remaining(deadline),
        'Assistant message did not become visible',
      );
      await this.pollValue(
        guard,
        async () => {
          const streaming =
            (await guard.run(() => target.getAttribute('data-message-streaming'))) === 'true' ||
            Boolean(await guard.run(() => target.$(CHATGPT_STREAMING_SELECTOR)));
          const stopped = Boolean(await guard.run(() => root.$(CHATGPT_STOP_SELECTOR)));
          const text = await guard.run(() => target.textContent());
          return !streaming && !stopped && (text?.trim().length ?? 0) > 0 ? true : undefined;
        },
        this.remaining(deadline),
        'Assistant response did not finish streaming',
      );
      await guard.run(async () => {
        await this.operationBoundary?.('before-text-extraction');
      });
      const text = (await guard.run(() => target.innerText())).trim();
      this.diagnostic(`assistant response complete, characters=${text.length}`);
      return text;
    } catch (error) {
      if (error instanceof ChatbridgeError && error.code === 'ORIGIN_DENIED') throw error;
      // Execution-context destruction can be reported just before Playwright emits
      // the navigation event. Give that event one turn so it wins the taxonomy.
      await guard.delay(25);
      // A navigation can destroy an ElementHandle's execution context before Playwright
      // delivers `framenavigated`; classify from the page's current origin as well.
      this.assertPageAllowed();
      if (error instanceof BridgeTimeoutError) throw error;
      throw new BridgeTimeoutError(
        `Timed out after ${timeout}ms waiting for a complete assistant response`,
      );
    } finally {
      guard.dispose();
    }
  }
  private async root(guard: OperationGuard) {
    const root = await guard.run(() => this.requiredPage().$('html'));
    if (!root)
      throw new ChatbridgeError('ChatGPT document root is unavailable', 'CHATGPT_DOCUMENT_MISSING');
    return root;
  }
  private async pollValue<T>(
    guard: OperationGuard,
    predicate: () => Promise<T | undefined>,
    timeout: number,
    message: string,
  ): Promise<T> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      guard.assertValid();
      const value = await predicate();
      guard.assertValid();
      if (value !== undefined) return value;
      await guard.delay(50);
    }
    throw new BridgeTimeoutError(message);
  }
  private remaining(deadline: number) {
    return Math.max(1, deadline - Date.now());
  }
  private requiredPage() {
    if (!this.page) throw new ChatbridgeError('Adapter is not connected', 'NOT_CONNECTED');
    return this.page;
  }
  private assertPageAllowed() {
    this.originPolicy.assertAllowed(this.requiredPage().url());
  }
  private guard() {
    this.assertPageAllowed();
    return new OperationGuard(this.requiredPage(), this.originPolicy);
  }
  private diagnostic(message: string) {
    if (this.debug) console.error(`[DEBUG] ${message}`);
  }
}

class OperationGuard {
  private invalid = false;
  private resolveInvalidation!: () => void;
  private readonly invalidated: Promise<void>;
  private readonly listener: (frame: Frame) => void;
  constructor(
    private readonly page: Page,
    private readonly policy: OriginPolicy,
  ) {
    this.invalidated = new Promise((resolve) => {
      this.resolveInvalidation = resolve;
    });
    this.listener = (frame) => {
      if (frame === page.mainFrame() && !policy.allows(frame.url())) {
        this.invalid = true;
        this.resolveInvalidation();
      }
    };
    page.on('framenavigated', this.listener);
  }
  assertValid() {
    if (this.invalid || !this.policy.allows(this.page.url())) {
      this.invalid = true;
      throw new ChatbridgeError('Page navigated outside the allowlisted origin', 'ORIGIN_DENIED');
    }
  }
  async run<T>(operation: () => Promise<T>) {
    this.assertValid();
    try {
      const value = await operation();
      this.assertValid();
      return value;
    } catch (error) {
      if (error instanceof Error && /execution context was destroyed/i.test(error.message))
        await this.delay(25);
      this.assertValid();
      throw error;
    }
  }
  async delay(ms: number) {
    this.assertValid();
    await Promise.race([new Promise((resolve) => setTimeout(resolve, ms)), this.invalidated]);
    this.assertValid();
  }
  dispose() {
    this.page.off('framenavigated', this.listener);
  }
}
