import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { PlaywrightChatGPTWebAdapter } from '../../src/browser/chatgpt-adapter.js';
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => browser.close());
async function fixture() {
  const isolated = await browser.newContext();
  await isolated.route('https://chatgpt.com/c/fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><main><div id="messages"></div><div id="prompt-textarea" role="textbox" contenteditable="true"></div><button aria-label="Send prompt" id="send">Send</button></main><script>window.sequence=0;send.onclick=()=>{window.sent=document.querySelector('#prompt-textarea').textContent;const user=document.createElement('div');user.dataset.messageAuthorRole='user';user.dataset.messageId='user-'+(++sequence);user.textContent=window.sent;messages.append(user)}</script>`,
    }),
  );
  const page = await isolated.newPage();
  await page.goto('https://chatgpt.com/c/fixture');
  return {
    page,
    adapter: new PlaywrightChatGPTWebAdapter(isolated, 'https://chatgpt.com/', 1000, false, [
      'https://chatgpt.com',
    ]),
  };
}
async function connectedFixture() {
  const x = await fixture();
  await x.adapter.connect();
  return x;
}
async function adversarialFixture(chatBody: string) {
  const isolated = await browser.newContext();
  await isolated.route('https://chatgpt.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: chatBody }),
  );
  await isolated.route('https://example.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<div id="prompt-textarea" role="textbox" contenteditable="true"></div><button aria-label="Send prompt" onclick="foreignClicks++">Send</button><div id="foreign" data-message-author-role="assistant">secret</div><script>window.foreignClicks=0;window.foreignReads=0;const foreign=document.querySelector("#foreign");Object.defineProperty(foreign,"innerText",{get(){foreignReads++;return "secret"}})</script>',
    }),
  );
  const page = await isolated.newPage();
  await page.goto('https://chatgpt.com/c/adversarial');
  const adapter = new PlaywrightChatGPTWebAdapter(isolated, 'https://chatgpt.com/', 1500, false, [
    'https://chatgpt.com',
  ]);
  await adapter.connect();
  return { isolated, page, adapter };
}
async function expectForeignUntouched(page: any) {
  await page.waitForURL('https://example.test/**');
  expect(
    await page.evaluate(() => ({
      composer: document.querySelector('#prompt-textarea')?.textContent,
      clicks: (window as any).foreignClicks,
      reads: (window as any).foreignReads,
    })),
  ).toEqual({ composer: '', clicks: 0, reads: 0 });
}
const checkpoint = (
  outgoingUserMessageId: string,
  conversationUrl = 'https://chatgpt.com/c/fixture',
) => ({
  conversationUrl,
  outgoingUserMessageId,
});
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
    expect(await adapter.sendMessage('hello')).toEqual({
      conversationUrl: 'https://chatgpt.com/c/fixture',
      outgoingUserMessageId: 'user-1',
    });
    expect(await page.evaluate(() => (window as any).sent)).toBe('hello');
    await page.close();
  });
  it('waits for a concrete URL after the outgoing ID appears on a blank new chat', async () => {
    const isolated = await browser.newContext();
    await isolated.route('https://chatgpt.com/', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<div id="messages"></div><div id="prompt-textarea" role="textbox" contenteditable="true"></div><button aria-label="Send prompt" id="send">Send</button><script>send.onclick=()=>{const user=document.createElement('div');user.dataset.messageAuthorRole='user';user.dataset.messageId='user-new';messages.append(user);setTimeout(()=>history.pushState({},'', '/c/new-conversation'),150)}</script>`,
      }),
    );
    const page = await isolated.newPage();
    await page.goto('https://chatgpt.com/');
    const adapter = new PlaywrightChatGPTWebAdapter(isolated, 'https://chatgpt.com/', 1000, false, [
      'https://chatgpt.com',
    ]);
    await adapter.connect();
    const started = Date.now();
    expect(await adapter.sendMessage('hello')).toEqual({
      conversationUrl: 'https://chatgpt.com/c/new-conversation',
      outgoingUserMessageId: 'user-new',
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
    await isolated.close();
  });
  it('fails as confirmed-side-effect when a blank chat never gains an identity', async () => {
    const isolated = await browser.newContext();
    await isolated.route('https://chatgpt.com/', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<div id="messages"></div><div id="prompt-textarea" role="textbox" contenteditable="true"></div><button aria-label="Send prompt" id="send">Send</button><script>window.clicks=0;send.onclick=()=>{clicks++;const user=document.createElement('div');user.dataset.messageAuthorRole='user';user.dataset.messageId='user-new';messages.append(user)}</script>`,
      }),
    );
    const page = await isolated.newPage();
    await page.goto('https://chatgpt.com/');
    const adapter = new PlaywrightChatGPTWebAdapter(isolated, 'https://chatgpt.com/', 150, false, [
      'https://chatgpt.com',
    ]);
    await adapter.connect();
    await expect(adapter.sendMessage('hello')).rejects.toMatchObject({
      code: 'SEND_CHECKPOINT_PERSIST_FAILED',
    });
    expect(await page.evaluate(() => (window as any).clicks)).toBe(1);
    await isolated.close();
  });
  it('classifies an origin escape after outgoing ID confirmation as checkpoint failure', async () => {
    const isolated = await browser.newContext();
    let clicks = 0;
    await isolated.exposeFunction('recordClick', () => clicks++);
    await isolated.route('https://chatgpt.com/', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<div id="messages"></div><div id="prompt-textarea" role="textbox" contenteditable="true"></div><button aria-label="Send prompt" id="send">Send</button><script>send.onclick=()=>{recordClick();const user=document.createElement('div');user.dataset.messageAuthorRole='user';user.dataset.messageId='user-new';messages.append(user);setTimeout(()=>location.href='https://example.test/post-confirmation',60)}</script>`,
      }),
    );
    await isolated.route('https://example.test/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<p>foreign</p>' }),
    );
    const page = await isolated.newPage();
    await page.goto('https://chatgpt.com/');
    const adapter = new PlaywrightChatGPTWebAdapter(isolated, 'https://chatgpt.com/', 1000, false, [
      'https://chatgpt.com',
    ]);
    await adapter.connect();
    const failure = await adapter.sendMessage('hello').catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'SEND_CHECKPOINT_PERSIST_FAILED' });
    expect((failure as Error).message).toContain('do not resend automatically');
    expect(clicks).toBe(1);
    await isolated.close();
  });
  it('preserves origin failure before outgoing ID confirmation', async () => {
    const isolated = await browser.newContext();
    let clicks = 0;
    await isolated.exposeFunction('recordClick', () => clicks++);
    await isolated.route('https://chatgpt.com/c/pre-confirmation', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<div id="messages"></div><div id="prompt-textarea" role="textbox" contenteditable="true"></div><button aria-label="Send prompt" id="send">Send</button><script>send.onclick=()=>{recordClick();setTimeout(()=>location.href='https://example.test/pre-confirmation',20)}</script>`,
      }),
    );
    await isolated.route('https://example.test/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<p>foreign</p>' }),
    );
    const page = await isolated.newPage();
    await page.goto('https://chatgpt.com/c/pre-confirmation');
    const adapter = new PlaywrightChatGPTWebAdapter(isolated, 'https://chatgpt.com/', 1000, false, [
      'https://chatgpt.com',
    ]);
    await adapter.connect();
    await expect(adapter.sendMessage('hello')).rejects.toMatchObject({ code: 'ORIGIN_DENIED' });
    expect(clicks).toBe(1);
    await isolated.close();
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
      m.innerHTML =
        '<div data-message-author-role="assistant" data-message-id="assistant-old">old</div><div data-message-author-role="user" data-message-id="user-anchor">prompt</div>';
      setTimeout(() => {
        const e = document.createElement('div');
        e.dataset.messageAuthorRole = 'assistant';
        e.dataset.messageId = 'assistant-new';
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
    expect(await adapter.waitForAssistantMessage({ checkpoint: checkpoint('user-anchor') })).toBe(
      'final response',
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
    await page.close();
  });
  it('selects the target when multiple messages exist', async () => {
    const { page, adapter } = await connectedFixture();
    await page.evaluate(() => {
      document.querySelector('#messages')!.innerHTML =
        '<div data-message-author-role="assistant" data-message-id="assistant-before">one</div><div data-message-author-role="user" data-message-id="user-target">prompt</div><div data-message-author-role="assistant" data-message-id="assistant-target">two</div><div data-message-author-role="assistant" data-message-id="assistant-after">three</div>';
    });
    expect(
      await adapter.waitForAssistantMessage({
        checkpoint: checkpoint('user-target'),
        timeoutMs: 500,
      }),
    ).toBe('two');
    await page.close();
  });
  it('detects a new assistant identity when the visible assistant count stays constant', async () => {
    const { page, adapter } = await connectedFixture();
    await page.evaluate(() => {
      const messages = document.querySelector('#messages')!;
      messages.innerHTML =
        '<div data-message-author-role="assistant" data-message-id="assistant-a">A</div><div data-message-author-role="assistant" data-message-id="assistant-b">B</div><div data-message-author-role="assistant" data-message-id="assistant-c">C</div><div data-message-author-role="user" data-message-id="user-window">prompt</div>';
      setTimeout(() => {
        messages.firstElementChild?.remove();
        messages.insertAdjacentHTML(
          'beforeend',
          '<div data-message-author-role="assistant" data-message-id="assistant-d">D</div>',
        );
      }, 50);
    });
    expect(await adapter.waitForAssistantMessage({ checkpoint: checkpoint('user-window') })).toBe(
      'D',
    );
    expect(await page.locator('[data-message-author-role="assistant"]').count()).toBe(3);
    await page.close();
  });
  it('re-queries an assistant replaced during streaming', async () => {
    const { page, adapter } = await connectedFixture();
    await page.evaluate(() => {
      const messages = document.querySelector('#messages')!;
      messages.innerHTML =
        '<div data-message-author-role="user" data-message-id="user-replace">prompt</div><div data-message-author-role="assistant" data-message-id="assistant-replace" data-message-streaming="true">partial</div>';
      setTimeout(() => {
        messages.lastElementChild?.remove();
        messages.insertAdjacentHTML(
          'beforeend',
          '<div data-message-author-role="assistant" data-message-id="assistant-replace">complete</div>',
        );
      }, 80);
    });
    expect(await adapter.waitForAssistantMessage({ checkpoint: checkpoint('user-replace') })).toBe(
      'complete',
    );
    await page.close();
  });
  it('fails closed when send cannot observe a stable outgoing user message ID', async () => {
    const isolated = await browser.newContext();
    const page = await isolated.newPage();
    await page.setContent(
      '<div id="prompt-textarea" role="textbox" contenteditable="true"></div><button aria-label="Send prompt" onclick="document.body.insertAdjacentHTML(\'beforeend\',\'<div data-message-author-role=user>sent</div>\')">Send</button>',
    );
    const adapter = new PlaywrightChatGPTWebAdapter(isolated, 'about:blank', 1000, false, [
      'about:blank',
    ]);
    await adapter.connect();
    await expect(adapter.sendMessage('hello')).rejects.toMatchObject({
      code: 'CHATGPT_MESSAGE_ID_UNAVAILABLE',
    });
    await isolated.close();
  });
  it('fails closed when the response has no stable assistant message ID', async () => {
    const { page, adapter } = await connectedFixture();
    await page.evaluate(() => {
      document.querySelector('#messages')!.innerHTML =
        '<div data-message-author-role="user" data-message-id="user-no-assistant-id">prompt</div><div data-message-author-role="assistant">response</div>';
    });
    await expect(
      adapter.waitForAssistantMessage({ checkpoint: checkpoint('user-no-assistant-id') }),
    ).rejects.toMatchObject({ code: 'CHATGPT_MESSAGE_ID_UNAVAILABLE' });
    await page.close();
  });
  it('fails when the checkpoint conversation tab is missing', async () => {
    const { page, adapter } = await connectedFixture();
    await page.close();
    await expect(
      adapter.waitForAssistantMessage({ checkpoint: checkpoint('user-1') }),
    ).rejects.toMatchObject({ code: 'CHATGPT_CONVERSATION_NOT_FOUND' });
  });
  it('rejects ambiguous ChatGPT tabs instead of selecting the first', async () => {
    const isolated = await browser.newContext();
    await isolated.newPage();
    await isolated.newPage();
    const adapter = new PlaywrightChatGPTWebAdapter(isolated, 'about:blank', 1000, false, [
      'about:blank',
    ]);
    await expect(adapter.connect()).rejects.toMatchObject({ code: 'CHATGPT_TAB_AMBIGUOUS' });
    await isolated.close();
  });
  it('targets one exact conversation despite unrelated ChatGPT tabs', async () => {
    const isolated = await browser.newContext();
    await isolated.route('https://chatgpt.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<div id="prompt-textarea" role="textbox" contenteditable="true"></div>',
      }),
    );
    const one = await isolated.newPage();
    const two = await isolated.newPage();
    const three = await isolated.newPage();
    await Promise.all([
      one.goto('https://chatgpt.com/c/one'),
      two.goto('https://chatgpt.com/c/two'),
      three.goto('https://chatgpt.com/c/three'),
    ]);
    const adapter = new PlaywrightChatGPTWebAdapter(isolated, 'https://chatgpt.com/', 1000, false, [
      'https://chatgpt.com',
    ]);
    expect(await adapter.connect({ conversationUrl: 'https://chatgpt.com/c/two' })).toEqual({
      conversationUrl: 'https://chatgpt.com/c/two',
    });
    expect(await adapter.isLoggedIn()).toBe(true);
    expect(one.url()).toBe('https://chatgpt.com/c/one');
    expect(three.url()).toBe('https://chatgpt.com/c/three');
    await isolated.close();
  });
  it('reopens an exact missing conversation and never falls back', async () => {
    const isolated = await browser.newContext();
    await isolated.route('https://chatgpt.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<div id="prompt-textarea" role="textbox" contenteditable="true"></div>',
      }),
    );
    const other = await isolated.newPage();
    await other.goto('https://chatgpt.com/c/other');
    const adapter = new PlaywrightChatGPTWebAdapter(isolated, 'https://chatgpt.com/', 1000, false, [
      'https://chatgpt.com',
    ]);
    expect(await adapter.connect({ conversationUrl: 'https://chatgpt.com/c/missing' })).toEqual({
      conversationUrl: 'https://chatgpt.com/c/missing',
    });
    expect(isolated.pages().map((page) => page.url())).toContain('https://chatgpt.com/c/missing');
    expect(other.url()).toBe('https://chatgpt.com/c/other');
    await isolated.close();
  });
  it('fails closed when reopening the exact target cannot navigate', async () => {
    const isolated = await browser.newContext();
    await isolated.route('https://chatgpt.com/c/missing', (route) => route.abort('failed'));
    const adapter = new PlaywrightChatGPTWebAdapter(isolated, 'https://chatgpt.com/', 1000, false, [
      'https://chatgpt.com',
    ]);
    await expect(
      adapter.connect({ conversationUrl: 'https://chatgpt.com/c/missing' }),
    ).rejects.toMatchObject({ code: 'CHATGPT_CONVERSATION_UNAVAILABLE' });
    await isolated.close();
  });
  it('reports timeout and never returns partial text', async () => {
    const { page, adapter } = await connectedFixture();
    await page.evaluate(() => {
      document.querySelector('#messages')!.innerHTML =
        '<div data-message-author-role="user" data-message-id="user-timeout">prompt</div><div data-message-author-role="assistant" data-message-id="assistant-timeout" data-message-streaming="true">partial</div>';
    });
    await expect(
      adapter.waitForAssistantMessage({ checkpoint: checkpoint('user-timeout'), timeoutMs: 100 }),
    ).rejects.toMatchObject({ code: 'BRIDGE_TIMEOUT' });
    await page.close();
  });
  it('aborts immediately when a streaming wait navigates across origins', async () => {
    const isolated = await browser.newContext();
    await isolated.route('https://chatgpt.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<div data-message-author-role="user" data-message-id="user-stream">prompt</div><div data-message-author-role="assistant" data-message-id="assistant-stream" data-message-streaming="true">partial</div>',
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
      adapter.waitForAssistantMessage({
        checkpoint: checkpoint('user-stream', 'https://chatgpt.com/c/wait'),
        timeoutMs: 1500,
      }),
    ).rejects.toMatchObject({ code: 'ORIGIN_DENIED' });
    expect(Date.now() - started).toBeLessThan(1000);
    await navigation;
    await isolated.close();
  });
  it('cancels navigation during composer visibility wait before foreign fill', async () => {
    const x = await adversarialFixture(
      '<script>setTimeout(()=>location.href="https://example.test/composer-wait",60)</script>',
    );
    await expect(x.adapter.sendMessage('must-not-fill')).rejects.toMatchObject({
      code: 'ORIGIN_DENIED',
    });
    await expectForeignUntouched(x.page);
    await x.isolated.close();
  });
  it('invalidates immediately before fill when the selected document navigates', async () => {
    const x = await adversarialFixture(
      '<script>setTimeout(()=>{document.body.innerHTML=`<div id="prompt-textarea" role="textbox" contenteditable="true"></div>`;setTimeout(()=>location.href="https://example.test/before-fill",1)},40)</script>',
    );
    await expect(x.adapter.sendMessage('must-not-fill')).rejects.toMatchObject({
      code: 'ORIGIN_DENIED',
    });
    await expectForeignUntouched(x.page);
    await x.isolated.close();
  });
  it('uses a document-bound composer so navigation between fill and send cannot click foreign DOM', async () => {
    const x = await adversarialFixture(
      '<div id="prompt-textarea" role="textbox" contenteditable="true" oninput="location.href=`https://example.test/after-fill`"></div><button aria-label="Send prompt">Send</button>',
    );
    await expect(x.adapter.sendMessage('trigger-navigation')).rejects.toMatchObject({
      code: 'ORIGIN_DENIED',
    });
    await expectForeignUntouched(x.page);
    await x.isolated.close();
  });
  it('cancels while waiting for assistant creation without reading the foreign assistant', async () => {
    const x = await adversarialFixture(
      '<script>setTimeout(()=>location.href="https://example.test/assistant-creation",60)</script>',
    );
    await expect(
      x.adapter.waitForAssistantMessage({
        checkpoint: checkpoint('missing-user', 'https://chatgpt.com/c/adversarial'),
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject({ code: 'ORIGIN_DENIED' });
    await expectForeignUntouched(x.page);
    await x.isolated.close();
  });
  it('discards extraction when navigation occurs immediately before innerText', async () => {
    const x = await adversarialFixture(
      '<div data-message-author-role="user" data-message-id="user-final">prompt</div><div id="answer" data-message-author-role="assistant" data-message-id="assistant-final">final</div>',
    );
    const adapter = new PlaywrightChatGPTWebAdapter(
      x.isolated,
      'https://chatgpt.com/',
      1500,
      false,
      ['https://chatgpt.com'],
      async () => {
        await x.page.goto('https://example.test/before-inner-text');
      },
    );
    await adapter.connect();
    await expect(
      adapter.waitForAssistantMessage({
        checkpoint: checkpoint('user-final', 'https://chatgpt.com/c/adversarial'),
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject({ code: 'ORIGIN_DENIED' });
    await expectForeignUntouched(x.page);
    await x.isolated.close();
  });
});
