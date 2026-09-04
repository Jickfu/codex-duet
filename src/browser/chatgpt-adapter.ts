import type { BrowserContext, ElementHandle, Frame, Page, Request } from 'playwright';
import { BridgeTimeoutError, ChatbridgeError } from '../core/errors.js';
import type {
  BrowserConnectOptions,
  BrowserConversationSelection,
  SendMarker,
  WaitOptions,
} from './browser-automation-session.js';
import {
  CHATGPT_COMPOSER_SELECTOR,
  CHATGPT_MESSAGE_SELECTOR,
  CHATGPT_SEND_SELECTOR,
  CHATGPT_STOP_SELECTOR,
  CHATGPT_STREAMING_SELECTOR,
} from './chatgpt-rules.js';
import { OriginPolicy } from './origin-policy.js';
import { ConversationUrlPolicy } from './conversation-url.js';

const MESSAGE_ID = /^[A-Za-z0-9_-]+$/;
type PreparedSendAction =
  { kind: 'button'; handle: ElementHandle } | { kind: 'keyboard'; handle: ElementHandle };

export interface ChatGPTWebAdapter {
  connect(options?: BrowserConnectOptions): Promise<BrowserConversationSelection>;
  ensureConversation(): Promise<void>;
  isLoggedIn(): Promise<boolean>;
  sendMessage(message: string): Promise<SendMarker>;
  waitForAssistantMessage(options: WaitOptions): Promise<string>;
}

export class PlaywrightChatGPTWebAdapter implements ChatGPTWebAdapter {
  private page?: Page;
  private readonly originPolicy: OriginPolicy;
  private readonly conversationUrls: ConversationUrlPolicy;
  constructor(
    private readonly context: BrowserContext,
    private readonly url: string,
    private readonly defaultTimeout = 120_000,
    private readonly debug = false,
    allowedOrigins: readonly string[] = ['https://chatgpt.com'],
    private readonly operationBoundary?: (name: 'before-text-extraction') => Promise<void> | void,
  ) {
    this.originPolicy = new OriginPolicy(allowedOrigins);
    this.conversationUrls = new ConversationUrlPolicy(allowedOrigins);
  }
  async connect(options: BrowserConnectOptions = {}): Promise<BrowserConversationSelection> {
    if (options.conversationUrl) {
      const target = this.conversationUrls.canonicalize(options.conversationUrl);
      const existing = this.context
        .pages()
        .find((page) => this.canonicalPageUrl(page.url()) === target);
      if (existing) this.page = existing;
      if (!this.page) {
        const page = await this.context.newPage();
        try {
          this.originPolicy.assertAllowed(target);
          await page.goto(target);
          this.originPolicy.assertAllowed(page.url());
          if (this.canonicalPageUrl(page.url()) !== target)
            throw new ChatbridgeError(
              'ChatGPT conversation did not resolve to the exact target',
              'CHATGPT_CONVERSATION_UNAVAILABLE',
            );
          this.page = page;
        } catch (error) {
          await page.close().catch(() => undefined);
          if (error instanceof ChatbridgeError) throw error;
          throw new ChatbridgeError(
            'The bound ChatGPT conversation is unavailable',
            'CHATGPT_CONVERSATION_UNAVAILABLE',
          );
        }
      }
      await this.ensureConversation();
      if (this.canonicalPageUrl(this.requiredPage().url()) !== target)
        throw new ChatbridgeError(
          'ChatGPT conversation identity changed',
          'CHATGPT_CONVERSATION_UNAVAILABLE',
        );
      return { conversationUrl: target };
    }
    const candidates = this.context.pages().filter((page) => this.originPolicy.allows(page.url()));
    if (candidates.length > 1)
      throw new ChatbridgeError(
        'Multiple ChatGPT tabs are available and no current tab is defined',
        'CHATGPT_TAB_AMBIGUOUS',
      );
    this.page = candidates[0] ?? (await this.context.newPage());
    await this.ensureConversation();
    return { conversationUrl: this.conversationUrls.canonicalize(this.requiredPage().url()) };
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
      const composer = await guard.run(() => this.requiredPage().$(CHATGPT_COMPOSER_SELECTOR));
      return composer ? await guard.run(() => composer.isVisible()) : false;
    } finally {
      guard.dispose();
    }
  }
  async sendMessage(message: string): Promise<SendMarker> {
    if (!message.trim()) throw new ChatbridgeError('Message must not be empty', 'EMPTY_MESSAGE');
    const guard = this.guard();
    try {
      const page = this.requiredPage();
      const before = await this.messageMetadata(guard);
      const previousUserMessageId = this.latestId(before, 'user');
      const previousAssistantMessageId = this.latestId(before, 'assistant');
      const composer = await this.pollValue(
        guard,
        async () => {
          const item = await guard.run(() => page.$(CHATGPT_COMPOSER_SELECTOR));
          return item && (await guard.run(() => item.isVisible())) ? item : undefined;
        },
        10_000,
        'Composer did not become visible',
      );
      await guard.run(() => composer.fill(message));
      const action = await this.prepareSendAction(guard, composer);
      if (action.kind === 'button')
        await guard.run(() => action.handle.click({ noWaitAfter: true, timeout: 10_000 }));
      else await guard.run(() => action.handle.press('Enter'));
      let outgoingUserMessageId: string;
      try {
        outgoingUserMessageId = await this.pollValue(
          guard,
          async () => {
            const latest = this.latestId(await this.messageMetadata(guard), 'user');
            return latest && latest !== previousUserMessageId ? latest : undefined;
          },
          Math.min(10_000, this.defaultTimeout),
          'Outgoing user message identity did not appear',
        );
      } catch (error) {
        if (error instanceof BridgeTimeoutError)
          throw new ChatbridgeError(
            'The outgoing user message has no stable data-message-id',
            'CHATGPT_MESSAGE_ID_UNAVAILABLE',
          );
        throw error;
      }
      let conversationUrl: string;
      try {
        conversationUrl = await this.pollValue(
          guard,
          async () => {
            const current = page.url();
            return this.conversationUrls.isStableConversationUrl(current)
              ? this.conversationUrls.canonicalizeStable(current)
              : undefined;
          },
          Math.min(10_000, this.defaultTimeout),
          'Stable conversation identity did not appear after confirmed send',
        );
      } catch (error) {
        const diagnostic = error instanceof ChatbridgeError && error.code ? ` (${error.code})` : '';
        throw new ChatbridgeError(
          `Send was confirmed but a durable conversation checkpoint could not be established; do not resend automatically${diagnostic}`,
          'SEND_CHECKPOINT_PERSIST_FAILED',
        );
      }
      return {
        conversationUrl,
        outgoingUserMessageId,
        ...(previousAssistantMessageId ? { previousAssistantMessageId } : {}),
      };
    } finally {
      guard.dispose();
    }
  }
  async waitForAssistantMessage(options: WaitOptions) {
    const timeout = options.timeoutMs ?? this.defaultTimeout;
    const checkpoint = options.checkpoint;
    this.validateMessageId(checkpoint.outgoingUserMessageId);
    const page = this.context.pages().find((item) => item.url() === checkpoint.conversationUrl);
    if (!page)
      throw new ChatbridgeError(
        'The checkpoint conversation tab is not available',
        'CHATGPT_CONVERSATION_NOT_FOUND',
      );
    this.page = page;
    const guard = this.guard();
    const deadline = Date.now() + timeout;
    let assistantId: string | undefined;
    let stableText: string | undefined;
    try {
      assistantId = await this.pollValue(
        guard,
        async () => this.assistantAfter(guard, checkpoint.outgoingUserMessageId),
        timeout,
        'Assistant message did not appear after the outgoing user turn',
      );
      this.validateMessageId(assistantId);
      const text = await this.pollValue(
        guard,
        async () => {
          const current = await this.messageById(guard, assistantId!);
          if (!current) return undefined;
          const streaming =
            (await guard.run(() => current.getAttribute('data-message-streaming'))) === 'true' ||
            Boolean(await guard.run(() => current.$(CHATGPT_STREAMING_SELECTOR)));
          const stopped = Boolean(await guard.run(() => page.$(CHATGPT_STOP_SELECTOR)));
          const value = (await guard.run(() => current.innerText())).trim();
          if (streaming || stopped || !value) {
            stableText = undefined;
            return undefined;
          }
          if (stableText === value) return value;
          stableText = value;
          return undefined;
        },
        this.remaining(deadline),
        'Assistant response did not finish streaming',
      );
      await guard.run(async () => this.operationBoundary?.('before-text-extraction'));
      guard.assertValid();
      this.diagnostic(`assistant response complete, id=${assistantId}, characters=${text.length}`);
      return text;
    } catch (error) {
      if (error instanceof ChatbridgeError) throw error;
      await guard.delay(25);
      this.assertPageAllowed();
      throw new BridgeTimeoutError(
        `Timed out after ${timeout}ms waiting for a complete assistant response`,
      );
    } finally {
      guard.dispose();
    }
  }
  private async messageMetadata(guard: OperationGuard) {
    const handles = await guard.run(() => this.requiredPage().$$(CHATGPT_MESSAGE_SELECTOR));
    const result: Array<{ id?: string; role: string }> = [];
    for (const handle of handles) {
      const id = await guard.run(() => handle.getAttribute('data-message-id'));
      const role = await guard.run(() => handle.getAttribute('data-message-author-role'));
      if (role) result.push(id && MESSAGE_ID.test(id) ? { id, role } : { role });
    }
    return result;
  }
  private latestId(messages: Array<{ id?: string; role: string }>, role: string) {
    return messages.filter((message) => message.role === role).at(-1)?.id;
  }
  private async assistantAfter(guard: OperationGuard, userId: string) {
    const messages = await this.messageMetadata(guard);
    const anchor = messages.findIndex(
      (message) => message.id === userId && message.role === 'user',
    );
    if (anchor < 0) return undefined;
    const found = messages.slice(anchor + 1).find((message) => message.role === 'assistant');
    if (found && !found.id)
      throw new ChatbridgeError(
        'The assistant message has no stable data-message-id',
        'CHATGPT_MESSAGE_ID_UNAVAILABLE',
      );
    return found?.id;
  }
  private async messageById(guard: OperationGuard, id: string): Promise<ElementHandle | undefined> {
    const handles = await guard.run(() => this.requiredPage().$$(CHATGPT_MESSAGE_SELECTOR));
    for (const handle of handles) {
      if ((await guard.run(() => handle.getAttribute('data-message-id'))) === id) return handle;
    }
    return undefined;
  }
  private validateMessageId(id: string) {
    if (!MESSAGE_ID.test(id))
      throw new ChatbridgeError(
        'Invalid ChatGPT message identity',
        'CHATGPT_MESSAGE_ID_UNAVAILABLE',
      );
  }
  private async prepareSendAction(
    guard: OperationGuard,
    composer: ElementHandle,
  ): Promise<PreparedSendAction> {
    const deadline = Date.now() + Math.min(10_000, this.defaultTimeout);
    let observedButton = false;
    while (Date.now() < deadline) {
      guard.assertValid();
      const candidates = await guard.run(() => this.requiredPage().$$(CHATGPT_SEND_SELECTOR));
      if (candidates.length > 0) observedButton = true;
      const visibleCandidates = [];
      for (const candidate of candidates)
        if (await guard.run(() => candidate.isVisible())) visibleCandidates.push(candidate);
      for (const [index, candidate] of visibleCandidates.entries()) {
        try {
          const remainingCandidates = visibleCandidates.length - index;
          const trialTimeout = Math.max(
            1,
            Math.min(2_000, Math.floor((deadline - Date.now()) / remainingCandidates)),
          );
          await guard.run(() =>
            candidate.click({
              trial: true,
              timeout: trialTimeout,
            }),
          );
          return { kind: 'button', handle: candidate };
        } catch (error) {
          guard.assertValid();
          if (error instanceof ChatbridgeError) throw error;
        }
      }
      await guard.delay(50);
    }
    if (observedButton)
      throw new ChatbridgeError(
        'Composer was filled, but no deterministic send action became actionable before timeout; no send action was attempted',
        'CHATGPT_SEND_NOT_READY',
      );
    return { kind: 'keyboard', handle: composer };
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
  private canonicalPageUrl(value: string): string | undefined {
    try {
      return this.conversationUrls.canonicalize(value);
    } catch {
      return undefined;
    }
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
  private readonly requestListener: (request: Request) => void;
  constructor(
    private readonly page: Page,
    private readonly policy: OriginPolicy,
  ) {
    this.invalidated = new Promise((resolve) => (this.resolveInvalidation = resolve));
    this.listener = (frame) => {
      if (frame === page.mainFrame() && !policy.allows(frame.url())) {
        this.invalid = true;
        this.resolveInvalidation();
      }
    };
    // A navigation request precedes document commit. Latch denial here rather than
    // hoping the framenavigated event arrives during an arbitrary error delay.
    this.requestListener = (request) => {
      if (
        request.isNavigationRequest() &&
        !policy.allows(request.url()) &&
        request.frame() === page.mainFrame()
      ) {
        this.invalid = true;
        this.resolveInvalidation();
      }
    };
    page.on('framenavigated', this.listener);
    page.on('request', this.requestListener);
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
    this.page.off('request', this.requestListener);
  }
}
