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
  return { page, adapter: new PlaywrightChatGPTWebAdapter(context, 'about:blank', 1000) };
}
async function connectedFixture() {
  const x = await fixture();
  await x.adapter.connect();
  return x;
}
describe('ChatGPT adapter fixture', () => {
  it('sends through the composer', async () => {
    const { page, adapter } = await connectedFixture();
    expect(await adapter.sendMessage('hello')).toBe(0);
    expect(await page.evaluate(() => (window as any).sent)).toBe('hello');
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
});
