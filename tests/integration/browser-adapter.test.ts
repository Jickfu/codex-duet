import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { PlaywrightChatGPTWebAdapter } from '../../src/browser/chatgpt-adapter.js';
let browser: Browser;
let context: BrowserContext;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
});
afterAll(async () => browser.close());
async function fixture() {
  const page = await context.newPage();
  await page.setContent(
    `<!doctype html><main><div id="messages"></div><div id="prompt-textarea" role="textbox" contenteditable="true"></div><button aria-label="Send prompt" id="send">Send</button></main><script>send.onclick=()=>{window.sent=document.querySelector('#prompt-textarea').textContent}</script>`,
  );
  return {
    page,
    adapter: new PlaywrightChatGPTWebAdapter(context, 'about:blank', 1000, false, ['about:blank']),
  };
}
async function connectedFixture() {
  const x = await fixture();
  await x.adapter.connect();
  return x;
}
describe('ChatGPT adapter fixture', () => {
  it('reuses an existing ChatGPT tab without reading an unrelated tab DOM', async () => {
    const isolated = await browser.newContext();
    let unrelatedReads = 0;
    await isolated.route('https://example.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<script>Object.defineProperty(document.body,"innerText",{get(){window.unrelatedReads=(window.unrelatedReads||0)+1;return "secret"}})</script><p>private</p>',
      }),
    );
    await isolated.route('https://chatgpt.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<div id="prompt-textarea" role="textbox" contenteditable="true"></div>',
      }),
    );
    const unrelated = await isolated.newPage();
    await unrelated.goto('https://example.test/private');
    const chatgpt = await isolated.newPage();
    await chatgpt.goto('https://chatgpt.com/c/existing');
    const adapter = new PlaywrightChatGPTWebAdapter(isolated, 'https://chatgpt.com/', 1000, false, [
      'https://chatgpt.com',
    ]);
    await adapter.connect();
    expect(await adapter.isLoggedIn()).toBe(true);
    unrelatedReads = await unrelated.evaluate(() => (window as any).unrelatedReads ?? 0);
    expect(unrelatedReads).toBe(0);
    expect(chatgpt.url()).toContain('/c/existing');
    expect(unrelated.url()).toContain('example.test');
    await chatgpt.goto('https://example.test/navigated-away');
    await expect(adapter.isLoggedIn()).rejects.toMatchObject({ code: 'ORIGIN_DENIED' });
    await isolated.close();
  });
  it('sends through the composer', async () => {
    const { page, adapter } = await connectedFixture();
    expect(await adapter.sendMessage('hello')).toBe(0);
    expect(await page.evaluate(() => (window as any).sent)).toBe('hello');
    await page.close();
  });
  it('does not leak navigation guards across long-running operations', async () => {
    const { page, adapter } = await connectedFixture();
    const before = (page as any).listenerCount('framenavigated');
    for (let i = 0; i < 10; i++) await adapter.sendMessage(`message-${i}`);
    expect((page as any).listenerCount('framenavigated')).toBe(before);
    await page.close();
  });
  it('waits through streaming and returns only the new final message', async () => {
    const { page, adapter } = await connectedFixture();
    await page.evaluate(() => {
      const m = document.querySelector('#messages')!;
      m.innerHTML = '<div data-message-author-role="assistant">old</div>';
      setTimeout(() => {
        const e = document.createElement('div');
        e.dataset.messageAuthorRole = 'assistant';
        e.dataset.messageStreaming = 'true';
        e.textContent = 'par';
        m.append(e);
        setTimeout(() => {
          e.textContent = 'final response';
          e.dataset.messageStreaming = 'false';
        }, 120);
      }, 30);
    });
    const started = Date.now();
    expect(await adapter.waitForAssistantMessage({ afterCount: 1 })).toBe('final response');
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
    await page.close();
  });
  it('selects the target when multiple messages exist', async () => {
    const { page, adapter } = await connectedFixture();
    await page.evaluate(() => {
      document.querySelector('#messages')!.innerHTML =
        '<div data-message-author-role="assistant">one</div><div data-message-author-role="assistant">two</div>';
    });
    expect(await adapter.waitForAssistantMessage({ afterCount: 1, timeoutMs: 500 })).toBe('two');
    await page.close();
  });
  it('reports timeout and never returns partial text', async () => {
    const { page, adapter } = await connectedFixture();
    await page.evaluate(() => {
      document.querySelector('#messages')!.innerHTML =
        '<div data-message-author-role="assistant" data-message-streaming="true">partial</div>';
    });
    await expect(
      adapter.waitForAssistantMessage({ afterCount: 0, timeoutMs: 100 }),
    ).rejects.toMatchObject({ code: 'BRIDGE_TIMEOUT' });
    await page.close();
  });
  it('aborts immediately when a streaming wait navigates across origins', async () => {
    const isolated = await browser.newContext();
    await isolated.route('https://chatgpt.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<div data-message-author-role="assistant" data-message-streaming="true">partial</div>',
      }),
    );
    await isolated.route('https://example.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<div data-message-author-role="assistant">foreign secret</div>',
      }),
    );
    const page = await isolated.newPage();
    await page.goto('https://chatgpt.com/c/wait');
    const adapter = new PlaywrightChatGPTWebAdapter(isolated, 'https://chatgpt.com/', 2000, false, [
      'https://chatgpt.com',
    ]);
    await adapter.connect();
    const navigation = new Promise<void>((resolve) =>
      setTimeout(
        () =>
          void page.goto('https://example.test/escape').then(
            () => resolve(),
            () => resolve(),
          ),
        50,
      ),
    );
    const started = Date.now();
    await expect(
      adapter.waitForAssistantMessage({ afterCount: 0, timeoutMs: 1500 }),
    ).rejects.toMatchObject({ code: 'ORIGIN_DENIED' });
    expect(Date.now() - started).toBeLessThan(1000);
    await navigation;
    await isolated.close();
  });
});
