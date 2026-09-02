import { describe, expect, it, vi } from 'vitest';
import { PlaywrightCliChatGPTSession } from '../../src/browser/playwright-cli-session.js';
import { buildCliOperation } from '../../src/browser/chatgpt-rules.js';
import {
  classifyCliFailure,
  formatCliDiagnostic,
} from '../../src/browser/playwright-cli-runner.js';
import { ChatbridgeError } from '../../src/core/errors.js';

const hexEnvelope = (value: unknown) =>
  Buffer.from(encodeURIComponent(JSON.stringify(value)), 'ascii').toString('hex');
const encoded = (args: readonly string[], value: unknown, kind = 'RESULT') => {
  const nonce = String(args[2]).match(/"nonce":"([^"]+)"/)?.[1];
  return `### Snapshot\nSECRET DOM\nCHATBRIDGE_${kind}_${nonce}_${hexEnvelope(value)}\n### Page`;
};
const decodedOutput = (output: string) => {
  const payload = output.match(/CHATBRIDGE_(?:RESULT|ERROR)_[^_]+_([A-Fa-f0-9]+)/)?.[1];
  return payload
    ? JSON.parse(decodeURIComponent(Buffer.from(payload, 'hex').toString('ascii')))
    : {};
};
const executeRestricted = (code: string, page: unknown, globals: Record<string, unknown> = {}) => {
  const names = [
    'URL',
    'setTimeout',
    'clearTimeout',
    'TextEncoder',
    'Buffer',
    'process',
    'performance',
    'window',
    'document',
  ];
  const operation = new Function(...names, `return (${code})`)(
    ...names.map((name) => globals[name]),
  );
  return operation(page);
};
describe('Playwright CLI transport', () => {
  it('reuses the connect-selected exact URL for login, prepare, and commit', async () => {
    const target = 'https://chatgpt.com/c/bound';
    const operations: string[] = [];
    const run = vi.fn(async (args: readonly string[]) => {
      const source = String(args[2]);
      const kind = source.match(/"kind":"([^"]+)"/)?.[1] ?? '';
      operations.push(source);
      const value =
        kind === 'ensure'
          ? { conversationUrl: target }
          : kind === 'login'
            ? true
            : kind === 'prepare'
              ? { conversationUrl: target, previousUserMessageId: 'old' }
              : { conversationUrl: target, outgoingUserMessageId: 'new' };
      return { stdout: encoded(args, { value }), stderr: '' };
    });
    const session = new PlaywrightCliChatGPTSession({ run }, 'stable', 'https://chatgpt.com/', [
      'https://chatgpt.com',
    ]);
    expect(await session.connect({ conversationUrl: target })).toEqual({ conversationUrl: target });
    expect(await session.isLoggedIn()).toBe(true);
    await session.sendMessage('message');
    for (const source of operations) expect(source).toContain(`"conversationUrl":"${target}"`);
  });
  it('exact-target connect bypasses global ambiguity and opens only the requested URL', async () => {
    const targetUrl = 'https://chatgpt.com/c/target';
    const other = (url: string): any => ({ url: () => url });
    const target = other(targetUrl);
    target.mainFrame = () => ({});
    target.on = vi.fn();
    target.off = vi.fn();
    const supplied: any = other('https://example.test/');
    supplied.context = () => ({
      pages: () => [
        other('https://chatgpt.com/c/one'),
        target,
        other('https://chatgpt.com/c/three'),
        supplied,
      ],
    });
    const output = await new Function(
      `return (${buildCliOperation(
        { kind: 'ensure', conversationUrl: targetUrl },
        'https://chatgpt.com/',
        ['https://chatgpt.com'],
        'exact',
      )})`,
    )()(supplied);
    expect(decodedOutput(output)).toEqual({ value: { conversationUrl: targetUrl } });
  });
  it('exact-target connect opens a missing URL and rejects identity-changing navigation', async () => {
    let current = 'about:blank';
    const created: any = {
      url: () => current,
      goto: vi.fn(async (url: string) => {
        current = url;
      }),
      mainFrame: () => ({}),
      on: vi.fn(),
      off: vi.fn(),
    };
    const supplied: any = {
      url: () => 'https://example.test/',
      context: () => ({ pages: () => [supplied], newPage: async () => created }),
    };
    const target = 'https://chatgpt.com/c/missing';
    const code = buildCliOperation(
      { kind: 'ensure', conversationUrl: target },
      'https://chatgpt.com/',
      ['https://chatgpt.com'],
      'open',
    );
    expect(decodedOutput(await new Function(`return (${code})`)()(supplied))).toEqual({
      value: { conversationUrl: target },
    });
    expect(created.goto).toHaveBeenCalledWith(target);

    current = 'about:blank';
    created.goto = vi.fn(async () => {
      current = 'https://chatgpt.com/c/other';
    });
    expect(decodedOutput(await new Function(`return (${code})`)()(supplied))).toEqual({
      code: 'CHATGPT_CONVERSATION_UNAVAILABLE',
    });
  });
  it('returns only structured bridge data, never CLI snapshot output', async () => {
    const marker = {
      conversationUrl: 'https://chatgpt.com/c/test',
      outgoingUserMessageId: 'user-new',
      previousAssistantMessageId: 'assistant-old',
    };
    const run = vi.fn(async (args: readonly string[], _timeout?: number) => {
      void _timeout;
      const kind = String(args[2]).match(/"kind":"([^"]+)"/)?.[1];
      return {
        stdout: encoded(args, {
          value:
            kind === 'prepare'
              ? {
                  conversationUrl: marker.conversationUrl,
                  previousUserMessageId: 'user-old',
                  previousAssistantMessageId: marker.previousAssistantMessageId,
                }
              : marker,
        }),
        stderr: '',
      };
    });
    const session = new PlaywrightCliChatGPTSession({ run }, 'test', 'https://chatgpt.com/', [
      'https://chatgpt.com',
    ]);
    expect(await session.sendMessage('hello')).toEqual(marker);
    expect(JSON.stringify(await session.sendMessage('again'))).not.toContain('SECRET DOM');
  });
  it('uses official detach and leaves external-browser lifecycle to the CLI', async () => {
    let browserRunning = true;
    const run = vi.fn(async (args: readonly string[]) => {
      if (args.includes('detach')) return { stdout: 'detached', stderr: '' };
      return { stdout: encoded(args, { ok: true }), stderr: '' };
    });
    const session = new PlaywrightCliChatGPTSession({ run }, 'lifecycle', 'https://chatgpt.com/', [
      'https://chatgpt.com',
    ]);
    await session.close();
    expect(run).toHaveBeenCalledWith(['--session=lifecycle', 'detach'], 5000);
    expect(browserRunning).toBe(true);
    browserRunning = false;
  });
  it('does not accumulate transport resources across repeated operations', async () => {
    const run = vi.fn(async (args: readonly string[]) => ({
      stdout: encoded(args, { value: true }),
      stderr: '',
    }));
    const session = new PlaywrightCliChatGPTSession({ run }, 'long', 'https://chatgpt.com/', [
      'https://chatgpt.com',
    ]);
    for (let i = 0; i < 20; i++) await session.isLoggedIn();
    expect(run).toHaveBeenCalledTimes(20);
  });
  it('recovers a committed send after a CLI process timeout without resending', async () => {
    const marker = {
      conversationUrl: 'https://chatgpt.com/c/recovered',
      outgoingUserMessageId: 'user-new',
      previousAssistantMessageId: 'assistant-old',
    };
    const run = vi.fn(async (args: readonly string[], _timeout?: number) => {
      void _timeout;
      const kind = String(args[2]).match(/"kind":"([^"]+)"/)?.[1];
      if (kind === 'commit') throw new ChatbridgeError('timeout', 'PLAYWRIGHT_CLI_TIMEOUT');
      return {
        stdout: encoded(args, {
          value:
            kind === 'prepare'
              ? {
                  conversationUrl: 'https://chatgpt.com/c/original',
                  previousUserMessageId: 'user-old',
                  previousAssistantMessageId: 'assistant-old',
                }
              : marker,
        }),
        stderr: '',
      };
    });
    const session = new PlaywrightCliChatGPTSession({ run }, 't', 'https://chatgpt.com/', [
      'https://chatgpt.com',
    ]);
    expect(await session.sendMessage('once')).toEqual(marker);
    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls[1]?.[1]).toBe(30_000);
    expect(
      run.mock.calls.filter(([args]) => String(args[2]).includes('"kind":"commit"')),
    ).toHaveLength(1);
  });
  it('enables exact-only recovery after an explicit target pin', async () => {
    const target = 'https://chatgpt.com/c/task';
    const sources: string[] = [];
    const run = vi.fn(async (args: readonly string[]) => {
      const source = String(args[2]);
      sources.push(source);
      const kind = source.match(/"kind":"([^"]+)"/)?.[1];
      if (kind === 'commit') throw new ChatbridgeError('timeout', 'PLAYWRIGHT_CLI_TIMEOUT');
      return {
        stdout: encoded(args, {
          value:
            kind === 'ensure'
              ? { conversationUrl: target }
              : kind === 'prepare'
                ? { conversationUrl: target, previousUserMessageId: 'old' }
                : { conversationUrl: target, outgoingUserMessageId: 'new' },
        }),
        stderr: '',
      };
    });
    const session = new PlaywrightCliChatGPTSession({ run }, 'strict', 'https://chatgpt.com/', [
      'https://chatgpt.com',
    ]);
    await session.connect({ conversationUrl: target });
    await session.sendMessage('once');
    const recovery = sources.find((source) => source.includes('"kind":"recover"'))!;
    expect(recovery).toContain('"exactOnly":true');
  });
  it('maps a missing exact recovery target to SEND_OUTCOME_UNKNOWN', async () => {
    const target = 'https://chatgpt.com/c/missing';
    const run = vi.fn(async (args: readonly string[]) => {
      const source = String(args[2]);
      const kind = source.match(/"kind":"([^"]+)"/)?.[1];
      if (kind === 'commit') throw new ChatbridgeError('timeout', 'PLAYWRIGHT_CLI_TIMEOUT');
      return {
        stdout: encoded(args, {
          value:
            kind === 'ensure'
              ? { conversationUrl: target }
              : kind === 'prepare'
                ? { conversationUrl: target, previousUserMessageId: 'old' }
                : null,
        }),
        stderr: '',
      };
    });
    const session = new PlaywrightCliChatGPTSession({ run }, 'missing', 'https://chatgpt.com/', [
      'https://chatgpt.com',
    ]);
    await session.connect({ conversationUrl: target });
    await expect(session.sendMessage('once')).rejects.toMatchObject({
      code: 'SEND_OUTCOME_UNKNOWN',
    });
  });
  it('keeps recovery broad after an unscoped legacy connect', async () => {
    const target = 'https://chatgpt.com/c/current';
    const sources: string[] = [];
    const run = vi.fn(async (args: readonly string[]) => {
      const source = String(args[2]);
      sources.push(source);
      const kind = source.match(/"kind":"([^"]+)"/)?.[1];
      if (kind === 'commit') throw new ChatbridgeError('timeout', 'PLAYWRIGHT_CLI_TIMEOUT');
      return {
        stdout: encoded(args, {
          value:
            kind === 'ensure'
              ? { conversationUrl: target }
              : kind === 'prepare'
                ? { conversationUrl: target, previousUserMessageId: 'old' }
                : { conversationUrl: target, outgoingUserMessageId: 'new' },
        }),
        stderr: '',
      };
    });
    const session = new PlaywrightCliChatGPTSession({ run }, 'legacy', 'https://chatgpt.com/', [
      'https://chatgpt.com',
    ]);
    await session.connect();
    await session.sendMessage('once');
    const recovery = sources.find((source) => source.includes('"kind":"recover"'))!;
    expect(recovery).toContain('"exactOnly":false');
  });
  it('reports an unknown send outcome when timeout recovery finds no new user identity', async () => {
    const run = vi.fn(async (args: readonly string[]) => {
      const kind = String(args[2]).match(/"kind":"([^"]+)"/)?.[1];
      if (kind === 'commit') throw new ChatbridgeError('timeout', 'PLAYWRIGHT_CLI_TIMEOUT');
      return {
        stdout: encoded(args, {
          value:
            kind === 'prepare'
              ? { conversationUrl: 'https://chatgpt.com/c/test', previousUserMessageId: 'old' }
              : null,
        }),
        stderr: '',
      };
    });
    const session = new PlaywrightCliChatGPTSession({ run }, 't', 'https://chatgpt.com/', [
      'https://chatgpt.com',
    ]);
    await expect(session.sendMessage('unknown')).rejects.toMatchObject({
      code: 'SEND_OUTCOME_UNKNOWN',
    });
    expect(run).toHaveBeenCalledTimes(3);
  });
  it('recovers a post-click message observer failure without a second commit', async () => {
    const marker = {
      conversationUrl: 'https://chatgpt.com/c/recovered',
      outgoingUserMessageId: 'user-new',
    };
    const run = vi.fn(async (args: readonly string[]) => {
      const kind = String(args[2]).match(/"kind":"([^"]+)"/)?.[1];
      if (kind === 'commit')
        return { stdout: encoded(args, { code: 'SEND_OBSERVER_FAILED' }, 'ERROR'), stderr: '' };
      return {
        stdout: encoded(args, {
          value:
            kind === 'prepare'
              ? { conversationUrl: 'https://chatgpt.com/c/original', previousUserMessageId: 'old' }
              : marker,
        }),
        stderr: '',
      };
    });
    const session = new PlaywrightCliChatGPTSession({ run }, 't', 'https://chatgpt.com/', [
      'https://chatgpt.com',
    ]);
    expect(await session.sendMessage('once')).toEqual(marker);
    expect(
      run.mock.calls.filter(([args]) => String(args[2]).includes('"kind":"commit"')),
    ).toHaveLength(1);
  });
  it('maps an unrecoverable post-click observer failure to SEND_OUTCOME_UNKNOWN', async () => {
    const run = vi.fn(async (args: readonly string[]) => {
      const kind = String(args[2]).match(/"kind":"([^"]+)"/)?.[1];
      if (kind === 'commit')
        return { stdout: encoded(args, { code: 'SEND_OBSERVER_FAILED' }, 'ERROR'), stderr: '' };
      return {
        stdout: encoded(args, {
          value:
            kind === 'prepare'
              ? { conversationUrl: 'https://chatgpt.com/c/test', previousUserMessageId: 'old' }
              : null,
        }),
        stderr: '',
      };
    });
    const session = new PlaywrightCliChatGPTSession({ run }, 't', 'https://chatgpt.com/', [
      'https://chatgpt.com',
    ]);
    await expect(session.sendMessage('unknown')).rejects.toMatchObject({
      code: 'SEND_OUTCOME_UNKNOWN',
    });
  });
  it('generated operations contain navigation abort guards and no storage/screenshot access', () => {
    const code = buildCliOperation(
      {
        kind: 'wait',
        conversationUrl: 'https://chatgpt.com/c/test',
        outgoingUserMessageId: 'user-id',
        timeoutMs: 1000,
      },
      'https://chatgpt.com/',
      ['https://chatgpt.com'],
    );
    expect(code).toContain('framenavigated');
    expect(code).not.toContain('new URL(');
    expect(code).not.toContain('globalThis.URL');
    expect(code).not.toMatch(/cookies\(|localStorage|sessionStorage|storageState|screenshot/);
  });
  it('keeps every production operation within the sandbox capability contract', () => {
    const operations = [
      { kind: 'ensure' as const },
      { kind: 'login' as const },
      { kind: 'prepare' as const },
      {
        kind: 'commit' as const,
        message: 'safe message',
        conversationUrl: 'https://chatgpt.com/c/test',
        previousUserMessageId: 'user-old',
      },
      {
        kind: 'recover' as const,
        conversationUrl: 'https://chatgpt.com/c/test',
        previousUserMessageId: 'user-old',
      },
      {
        kind: 'wait' as const,
        conversationUrl: 'https://chatgpt.com/c/test',
        outgoingUserMessageId: 'user-new',
        timeoutMs: 1000,
      },
    ];
    const forbidden =
      /\bnew\s+URL\s*\(|\bsetTimeout\s*\(|\bclearTimeout\s*\(|\bTextEncoder\b|\bBuffer\b|\bprocess\s*\.|\bperformance\s*\.|\bwindow\s*\.|\bdocument\s*\./;
    for (const operation of operations) {
      const code = buildCliOperation(operation, 'https://chatgpt.com/', ['https://chatgpt.com']);
      expect(code).not.toMatch(forbidden);
      expect(code).toContain('page.waitForTimeout');
    }
  });
  it.each([
    ['https://chatgpt.com/', true],
    ['https://chatgpt.com/c/abc', true],
    ['https://chatgpt.com.evil.example', false],
    ['https://chatgpt.com@evil.example', false],
    ['http://chatgpt.com', false],
    ['https://evil.example', false],
  ])('matches %s safely when the sandbox URL global is undefined', async (candidate, allowed) => {
    const code = buildCliOperation(
      { kind: 'ensure' },
      candidate,
      ['HTTPS://CHATGPT.COM:443/'],
      'sandbox',
    );
    const frame = {};
    const target: any = {
      url: () => candidate,
      goto: vi.fn(async () => undefined),
      on: vi.fn(),
      off: vi.fn(),
      mainFrame: () => frame,
      $: vi.fn(async () => ({})),
      context: () => ({ pages: () => [target], newPage: async () => target }),
    };
    const page: any = target;
    const operation = new Function('URL', `return (${code})`)(undefined);
    const output = await operation(page);
    expect(output.startsWith(allowed ? 'CHATBRIDGE_RESULT_' : 'CHATBRIDGE_ERROR_')).toBe(true);
  });
  it('uses the supplied current ChatGPT page even when additional ChatGPT tabs exist', async () => {
    const element = (id: string, role: string) => ({
      getAttribute: async (name: string) =>
        name === 'data-message-id' ? id : name === 'data-message-author-role' ? role : null,
    });
    const current: any = {
      url: () => 'https://chatgpt.com/c/current',
      on: vi.fn(),
      off: vi.fn(),
      mainFrame: () => ({}),
      $$: vi.fn(async () => [element('user-current', 'user')]),
    };
    const homepage: any = {
      url: () => 'https://chatgpt.com/',
      $$: vi.fn(async () => [element('user-other', 'user')]),
    };
    current.context = () => ({ pages: () => [homepage, current] });
    const operation = new Function(
      `return (${buildCliOperation({ kind: 'prepare' }, 'https://chatgpt.com/', ['https://chatgpt.com'], 'tabs')})`,
    )();
    const output = await operation(current);
    expect(output).toContain('CHATBRIDGE_RESULT_tabs_');
    expect(current.$$).toHaveBeenCalledOnce();
    expect(homepage.$$).not.toHaveBeenCalled();
  });
  it('rejects multiple ChatGPT candidates when the supplied page is not ChatGPT', async () => {
    const candidate = (url: string): any => ({ url: () => url });
    const foreign: any = {
      url: () => 'https://example.test/',
      context: () => ({
        pages: () => [
          candidate('https://chatgpt.com/c/one'),
          candidate('https://chatgpt.com/c/two'),
          foreign,
        ],
      }),
    };
    const operation = new Function(
      `return (${buildCliOperation({ kind: 'prepare' }, 'https://chatgpt.com/', ['https://chatgpt.com'], 'ambiguous')})`,
    )();
    expect(await operation(foreign)).toContain('CHATBRIDGE_ERROR_ambiguous_');
  });
  it('polls wait through page.waitForTimeout with forbidden globals unavailable', async () => {
    const waits: number[] = [];
    let streamingReads = 0;
    const user = {
      getAttribute: async (name: string) => (name === 'data-message-id' ? 'user-anchor' : 'user'),
    };
    const assistant = {
      getAttribute: async (name: string) => {
        if (name === 'data-message-id') return 'assistant-target';
        if (name === 'data-message-author-role') return 'assistant';
        if (name === 'data-message-streaming') return streamingReads++ === 0 ? 'true' : null;
        return null;
      },
      $: async () => null,
      innerText: async () => 'final response',
    };
    const target: any = {
      url: () => 'https://chatgpt.com/c/wait',
      context: () => ({ pages: () => [target] }),
      mainFrame: () => ({}),
      on: vi.fn(),
      off: vi.fn(),
      $$: async () => [user, assistant],
      $: async () => null,
      waitForTimeout: async (ms: number) => waits.push(ms),
    };
    const output = await executeRestricted(
      buildCliOperation(
        {
          kind: 'wait',
          conversationUrl: target.url(),
          outgoingUserMessageId: 'user-anchor',
          timeoutMs: 1000,
        },
        'https://chatgpt.com/',
        ['https://chatgpt.com'],
        'restricted-wait',
      ),
      target,
    );
    expect(decodedOutput(output)).toEqual({ value: 'final response' });
    expect(waits).toEqual([50, 50]);
  });
  it('polls outgoing identity through page.waitForTimeout in the restricted sandbox', async () => {
    const waits: number[] = [];
    let metadataReads = 0;
    const message = (id: string) => ({
      getAttribute: async (name: string) => (name === 'data-message-id' ? id : 'user'),
    });
    const composer = {
      isVisible: async () => true,
      fill: async () => undefined,
      press: async () => undefined,
    };
    const send = { isVisible: async () => true, click: async () => undefined };
    const target: any = {
      url: () => 'https://chatgpt.com/c/commit',
      context: () => ({ pages: () => [target] }),
      mainFrame: () => ({}),
      on: vi.fn(),
      off: vi.fn(),
      $$: async (selector: string) =>
        selector.includes('send-button')
          ? [send]
          : [message(metadataReads++ < 2 ? 'user-old' : 'user-new')],
      $: async (selector: string) => (selector.includes('prompt-textarea') ? composer : send),
      waitForTimeout: async (ms: number) => waits.push(ms),
    };
    const output = await executeRestricted(
      buildCliOperation(
        {
          kind: 'commit',
          message: 'once',
          conversationUrl: target.url(),
          previousUserMessageId: 'user-old',
        },
        'https://chatgpt.com/',
        ['https://chatgpt.com'],
        'restricted-commit',
      ),
      target,
    );
    expect(decodedOutput(output)).toMatchObject({
      value: { outgoingUserMessageId: 'user-new' },
    });
    expect(waits).toEqual([50]);
  });
  it('preflights a disabled button until actionable and clicks exactly once', async () => {
    let trialAttempts = 0;
    let actualClicks = 0;
    let sent = false;
    const message = (id: string) => ({
      getAttribute: async (name: string) => (name === 'data-message-id' ? id : 'user'),
    });
    const composer = {
      isVisible: async () => true,
      fill: async () => undefined,
      press: async () => undefined,
    };
    const send = {
      isVisible: async () => true,
      click: async (options?: { trial?: boolean }) => {
        if (options?.trial) {
          trialAttempts++;
          if (trialAttempts < 3) throw new Error('not actionable');
          return;
        }
        actualClicks++;
        sent = true;
      },
    };
    const target: any = {
      url: () => 'https://chatgpt.com/c/ready',
      context: () => ({ pages: () => [target] }),
      mainFrame: () => ({}),
      on: vi.fn(),
      off: vi.fn(),
      $$: async (selector: string) =>
        selector.includes('send-button') ? [send] : [message(sent ? 'user-new' : 'user-old')],
      $: async (selector: string) => (selector.includes('prompt-textarea') ? composer : send),
      waitForTimeout: async () => undefined,
    };
    const output = await executeRestricted(
      buildCliOperation(
        {
          kind: 'commit',
          message: 'once',
          conversationUrl: target.url(),
          previousUserMessageId: 'user-old',
        },
        'https://chatgpt.com/',
        ['https://chatgpt.com'],
        'disabled-ready',
      ),
      target,
    );
    expect(decodedOutput(output)).toMatchObject({
      value: { outgoingUserMessageId: 'user-new' },
    });
    expect(trialAttempts).toBe(3);
    expect(actualClicks).toBe(1);
  });

  it('selects the second send candidate when the first candidate is disabled', async () => {
    let disabledActualClicks = 0;
    let liveActualClicks = 0;
    let enterPresses = 0;
    let sent = false;
    const message = (id: string) => ({
      getAttribute: async (name: string) => (name === 'data-message-id' ? id : 'user'),
    });
    const composer = {
      isVisible: async () => true,
      fill: async () => undefined,
      press: async () => enterPresses++,
    };
    const disabled = {
      isVisible: async () => true,
      click: async (options?: { trial?: boolean }) => {
        if (options?.trial) throw new Error('disabled');
        disabledActualClicks++;
      },
    };
    const live = {
      isVisible: async () => true,
      click: async (options?: { trial?: boolean }) => {
        if (options?.trial) return;
        liveActualClicks++;
        sent = true;
      },
    };
    const target: any = {
      url: () => 'https://chatgpt.com/c/second-actionable',
      context: () => ({ pages: () => [target] }),
      mainFrame: () => ({}),
      on: vi.fn(),
      off: vi.fn(),
      $$: async (selector: string) =>
        selector.includes('send-button')
          ? [disabled, live]
          : [message(sent ? 'user-new' : 'user-old')],
      $: async (selector: string) => (selector.includes('prompt-textarea') ? composer : undefined),
      waitForTimeout: async () => undefined,
    };
    const output = await executeRestricted(
      buildCliOperation(
        {
          kind: 'commit',
          message: 'once',
          conversationUrl: target.url(),
          previousUserMessageId: 'user-old',
        },
        'https://chatgpt.com/',
        ['https://chatgpt.com'],
        'second-actionable',
      ),
      target,
    );
    expect(decodedOutput(output)).toMatchObject({
      value: { outgoingUserMessageId: 'user-new' },
    });
    expect(disabledActualClicks).toBe(0);
    expect(liveActualClicks).toBe(1);
    expect(enterPresses).toBe(0);
  });

  it('skips a hidden stale candidate and clicks the visible send candidate', async () => {
    let staleClicks = 0;
    let liveActualClicks = 0;
    let sent = false;
    const message = (id: string) => ({
      getAttribute: async (name: string) => (name === 'data-message-id' ? id : 'user'),
    });
    const composer = {
      isVisible: async () => true,
      fill: async () => undefined,
      press: async () => undefined,
    };
    const stale = {
      isVisible: async () => false,
      click: async () => staleClicks++,
    };
    const live = {
      isVisible: async () => true,
      click: async (options?: { trial?: boolean }) => {
        if (options?.trial) return;
        liveActualClicks++;
        sent = true;
      },
    };
    const target: any = {
      url: () => 'https://chatgpt.com/c/stale-candidate',
      context: () => ({ pages: () => [target] }),
      mainFrame: () => ({}),
      on: vi.fn(),
      off: vi.fn(),
      $$: async (selector: string) =>
        selector.includes('send-button')
          ? [stale, live]
          : [message(sent ? 'user-new' : 'user-old')],
      $: async (selector: string) => (selector.includes('prompt-textarea') ? composer : undefined),
      waitForTimeout: async () => undefined,
    };
    const output = await executeRestricted(
      buildCliOperation(
        {
          kind: 'commit',
          message: 'once',
          conversationUrl: target.url(),
          previousUserMessageId: 'user-old',
        },
        'https://chatgpt.com/',
        ['https://chatgpt.com'],
        'stale-candidate',
      ),
      target,
    );
    expect(decodedOutput(output)).toMatchObject({
      value: { outgoingUserMessageId: 'user-new' },
    });
    expect(staleClicks).toBe(0);
    expect(liveActualClicks).toBe(1);
  });

  it('re-queries send candidates after dynamic node replacement', async () => {
    let candidateQueries = 0;
    let staleTrialAttempts = 0;
    let liveActualClicks = 0;
    let sent = false;
    const message = (id: string) => ({
      getAttribute: async (name: string) => (name === 'data-message-id' ? id : 'user'),
    });
    const composer = {
      isVisible: async () => true,
      fill: async () => undefined,
      press: async () => undefined,
    };
    const stale = {
      isVisible: async () => true,
      click: async (options?: { trial?: boolean }) => {
        if (options?.trial) staleTrialAttempts++;
        throw new Error('detached');
      },
    };
    const live = {
      isVisible: async () => true,
      click: async (options?: { trial?: boolean }) => {
        if (options?.trial) return;
        liveActualClicks++;
        sent = true;
      },
    };
    const target: any = {
      url: () => 'https://chatgpt.com/c/node-replacement',
      context: () => ({ pages: () => [target] }),
      mainFrame: () => ({}),
      on: vi.fn(),
      off: vi.fn(),
      $$: async (selector: string) => {
        if (!selector.includes('send-button')) return [message(sent ? 'user-new' : 'user-old')];
        candidateQueries++;
        return candidateQueries === 1 ? [stale] : [live];
      },
      $: async (selector: string) => (selector.includes('prompt-textarea') ? composer : undefined),
      waitForTimeout: async () => undefined,
    };
    const output = await executeRestricted(
      buildCliOperation(
        {
          kind: 'commit',
          message: 'once',
          conversationUrl: target.url(),
          previousUserMessageId: 'user-old',
        },
        'https://chatgpt.com/',
        ['https://chatgpt.com'],
        'node-replacement',
      ),
      target,
    );
    expect(decodedOutput(output)).toMatchObject({
      value: { outgoingUserMessageId: 'user-new' },
    });
    expect(candidateQueries).toBeGreaterThanOrEqual(2);
    expect(staleTrialAttempts).toBe(1);
    expect(liveActualClicks).toBe(1);
  });

  it('fails pre-commit when every observed send candidate is non-actionable', async () => {
    let clock = 0;
    let actualClicks = 0;
    let enterPresses = 0;
    const oldUser = {
      getAttribute: async (name: string) => (name === 'data-message-id' ? 'user-old' : 'user'),
    };
    const composer = {
      isVisible: async () => true,
      fill: async () => undefined,
      press: async () => enterPresses++,
    };
    const disabled = {
      isVisible: async () => true,
      click: async (options?: { trial?: boolean }) => {
        if (options?.trial) throw new Error('disabled');
        actualClicks++;
      },
    };
    const hidden = {
      isVisible: async () => false,
      click: async () => actualClicks++,
    };
    const covered = {
      isVisible: async () => true,
      click: async (options?: { trial?: boolean }) => {
        if (options?.trial) throw new Error('covered');
        actualClicks++;
      },
    };
    const target: any = {
      url: () => 'https://chatgpt.com/c/all-not-ready',
      context: () => ({ pages: () => [target] }),
      mainFrame: () => ({}),
      on: vi.fn(),
      off: vi.fn(),
      $$: async (selector: string) =>
        selector.includes('send-button') ? [disabled, hidden, covered] : [oldUser],
      $: async (selector: string) => (selector.includes('prompt-textarea') ? composer : undefined),
      waitForTimeout: async () => undefined,
    };
    const code = buildCliOperation(
      {
        kind: 'commit',
        message: 'once',
        conversationUrl: target.url(),
        previousUserMessageId: 'user-old',
      },
      'https://chatgpt.com/',
      ['https://chatgpt.com'],
      'all-not-ready',
    );
    const operation = new Function('Date', `return (${code})`)({ now: () => (clock += 1000) });
    expect(decodedOutput(await operation(target))).toEqual({ code: 'CHATGPT_SEND_NOT_READY' });
    expect(actualClicks).toBe(0);
    expect(enterPresses).toBe(0);
  });

  it('fails closed when a candidate trial observes a main-frame origin escape', async () => {
    let currentUrl = 'https://chatgpt.com/c/trial-origin';
    let listener: ((frame: object) => void) | undefined;
    let liveTrials = 0;
    let actualClicks = 0;
    const frame = {};
    const oldUser = {
      getAttribute: async (name: string) => (name === 'data-message-id' ? 'user-old' : 'user'),
    };
    const composer = {
      isVisible: async () => true,
      fill: async () => undefined,
      press: async () => undefined,
    };
    const escaping = {
      isVisible: async () => true,
      click: async (options?: { trial?: boolean }) => {
        if (options?.trial) {
          currentUrl = 'https://example.test/escape';
          listener?.(frame);
          throw new Error('navigation raced');
        }
        actualClicks++;
      },
    };
    const live = {
      isVisible: async () => true,
      click: async (options?: { trial?: boolean }) => {
        if (options?.trial) liveTrials++;
        else actualClicks++;
      },
    };
    const target: any = {
      url: () => currentUrl,
      context: () => ({ pages: () => [target] }),
      mainFrame: () => frame,
      on: (_event: string, value: (navigated: object) => void) => (listener = value),
      off: vi.fn(),
      $$: async (selector: string) =>
        selector.includes('send-button') ? [escaping, live] : [oldUser],
      $: async (selector: string) => (selector.includes('prompt-textarea') ? composer : undefined),
      waitForTimeout: async () => undefined,
    };
    const output = await executeRestricted(
      buildCliOperation(
        {
          kind: 'commit',
          message: 'once',
          conversationUrl: currentUrl,
          previousUserMessageId: 'user-old',
        },
        'https://chatgpt.com/',
        ['https://chatgpt.com'],
        'trial-origin',
      ),
      target,
    );
    expect(decodedOutput(output)).toEqual({ code: 'ORIGIN_DENIED' });
    expect(liveTrials).toBe(0);
    expect(actualClicks).toBe(0);
  });

  it('returns pre-commit not-ready without click when an observed button stays disabled', async () => {
    let clock = 0;
    let actualClicks = 0;
    const oldUser = {
      getAttribute: async (name: string) => (name === 'data-message-id' ? 'user-old' : 'user'),
    };
    const composer = {
      isVisible: async () => true,
      fill: async () => undefined,
      press: async () => undefined,
    };
    const send = {
      isVisible: async () => true,
      click: async (options?: { trial?: boolean }) => {
        if (options?.trial) throw new Error('disabled');
        actualClicks++;
      },
    };
    const target: any = {
      url: () => 'https://chatgpt.com/c/not-ready',
      context: () => ({ pages: () => [target] }),
      mainFrame: () => ({}),
      on: vi.fn(),
      off: vi.fn(),
      $$: async (selector: string) => (selector.includes('send-button') ? [send] : [oldUser]),
      $: async (selector: string) => (selector.includes('prompt-textarea') ? composer : send),
      waitForTimeout: async () => undefined,
    };
    const code = buildCliOperation(
      {
        kind: 'commit',
        message: 'once',
        conversationUrl: target.url(),
        previousUserMessageId: 'user-old',
      },
      'https://chatgpt.com/',
      ['https://chatgpt.com'],
      'never-actionable',
    );
    const operation = new Function('Date', `return (${code})`)({ now: () => (clock += 1000) });
    expect(decodedOutput(await operation(target))).toEqual({ code: 'CHATGPT_SEND_NOT_READY' });
    expect(actualClicks).toBe(0);
  });

  it('waits for an asynchronously appearing button instead of pressing Enter', async () => {
    let buttonQueries = 0;
    let actualClicks = 0;
    let enterPresses = 0;
    let sent = false;
    const message = (id: string) => ({
      getAttribute: async (name: string) => (name === 'data-message-id' ? id : 'user'),
    });
    const composer = {
      isVisible: async () => true,
      fill: async () => undefined,
      press: async () => {
        enterPresses++;
      },
    };
    const send = {
      isVisible: async () => true,
      click: async (options?: { trial?: boolean }) => {
        if (!options?.trial) {
          actualClicks++;
          sent = true;
        }
      },
    };
    const target: any = {
      url: () => 'https://chatgpt.com/c/async',
      context: () => ({ pages: () => [target] }),
      mainFrame: () => ({}),
      on: vi.fn(),
      off: vi.fn(),
      $$: async (selector: string) => {
        if (!selector.includes('send-button')) return [message(sent ? 'user-new' : 'user-old')];
        buttonQueries++;
        return buttonQueries < 3 ? [] : [send];
      },
      $: async (selector: string) => {
        if (selector.includes('prompt-textarea')) return composer;
        return undefined;
      },
      waitForTimeout: async () => undefined,
    };
    const output = await executeRestricted(
      buildCliOperation(
        {
          kind: 'commit',
          message: 'once',
          conversationUrl: target.url(),
          previousUserMessageId: 'user-old',
        },
        'https://chatgpt.com/',
        ['https://chatgpt.com'],
        'async-button',
      ),
      target,
    );
    expect(decodedOutput(output)).toMatchObject({
      value: { outgoingUserMessageId: 'user-new' },
    });
    expect(actualClicks).toBe(1);
    expect(enterPresses).toBe(0);
  });

  it('preserves keyboard fallback when no button appears in the readiness window', async () => {
    let clock = 0;
    let enterPresses = 0;
    let sent = false;
    const message = (id: string) => ({
      getAttribute: async (name: string) => (name === 'data-message-id' ? id : 'user'),
    });
    const composer = {
      isVisible: async () => true,
      fill: async () => undefined,
      press: async () => {
        enterPresses++;
        sent = true;
      },
    };
    const target: any = {
      url: () => 'https://chatgpt.com/c/keyboard',
      context: () => ({ pages: () => [target] }),
      mainFrame: () => ({}),
      on: vi.fn(),
      off: vi.fn(),
      $$: async (selector: string) =>
        selector.includes('send-button') ? [] : [message(sent ? 'user-new' : 'user-old')],
      $: async (selector: string) => (selector.includes('prompt-textarea') ? composer : undefined),
      waitForTimeout: async () => undefined,
    };
    const code = buildCliOperation(
      {
        kind: 'commit',
        message: 'once',
        conversationUrl: target.url(),
        previousUserMessageId: 'user-old',
      },
      'https://chatgpt.com/',
      ['https://chatgpt.com'],
      'keyboard-fallback',
    );
    const operation = new Function('Date', `return (${code})`)({ now: () => (clock += 6000) });
    expect(decodedOutput(await operation(target))).toMatchObject({
      value: { outgoingUserMessageId: 'user-new' },
    });
    expect(enterPresses).toBe(1);
  });

  it('keeps actual-click failure after trial inside observer recovery semantics', async () => {
    let actualClicks = 0;
    const oldUser = {
      getAttribute: async (name: string) => (name === 'data-message-id' ? 'user-old' : 'user'),
    };
    const composer = {
      isVisible: async () => true,
      fill: async () => undefined,
      press: async () => undefined,
    };
    const send = {
      isVisible: async () => true,
      click: async (options?: { trial?: boolean }) => {
        if (options?.trial) return;
        actualClicks++;
        throw new Error('actionability raced');
      },
    };
    const target: any = {
      url: () => 'https://chatgpt.com/c/click-race',
      context: () => ({ pages: () => [target] }),
      mainFrame: () => ({}),
      on: vi.fn(),
      off: vi.fn(),
      $$: async (selector: string) => (selector.includes('send-button') ? [send] : [oldUser]),
      $: async (selector: string) => (selector.includes('prompt-textarea') ? composer : send),
      waitForTimeout: async () => undefined,
    };
    const output = await executeRestricted(
      buildCliOperation(
        {
          kind: 'commit',
          message: 'once',
          conversationUrl: target.url(),
          previousUserMessageId: 'user-old',
        },
        'https://chatgpt.com/',
        ['https://chatgpt.com'],
        'actual-click-race',
      ),
      target,
    );
    expect(decodedOutput(output)).toEqual({ code: 'SEND_OBSERVER_FAILED' });
    expect(actualClicks).toBe(1);
  });
  it('waits for a concrete conversation URL after observing the outgoing ID', async () => {
    const waits: number[] = [];
    let currentUrl = 'https://chatgpt.com/';
    let metadataReads = 0;
    const message = (id: string) => ({
      getAttribute: async (name: string) => (name === 'data-message-id' ? id : 'user'),
    });
    const composer = {
      isVisible: async () => true,
      fill: async () => undefined,
      press: async () => undefined,
    };
    const send = { isVisible: async () => true, click: async () => undefined };
    const target: any = {
      url: () => currentUrl,
      context: () => ({ pages: () => [target] }),
      mainFrame: () => ({}),
      on: vi.fn(),
      off: vi.fn(),
      $$: async (selector: string) =>
        selector.includes('send-button')
          ? [send]
          : [message(metadataReads++ === 0 ? 'user-old' : 'user-new')],
      $: async (selector: string) => (selector.includes('prompt-textarea') ? composer : send),
      waitForTimeout: async (ms: number) => {
        waits.push(ms);
        if (waits.length === 2) currentUrl = 'https://chatgpt.com/c/new-conversation';
      },
    };
    const output = await executeRestricted(
      buildCliOperation(
        {
          kind: 'commit',
          message: 'once',
          conversationUrl: 'https://chatgpt.com/',
          previousUserMessageId: 'user-old',
        },
        'https://chatgpt.com/',
        ['https://chatgpt.com'],
        'blank-transition',
      ),
      target,
    );
    expect(decodedOutput(output)).toEqual({
      value: {
        conversationUrl: 'https://chatgpt.com/c/new-conversation',
        outgoingUserMessageId: 'user-new',
      },
    });
    expect(waits).toEqual([50, 50]);
  });

  it('reports a confirmed-side-effect failure when a stable URL never appears', async () => {
    let clicks = 0;
    let clock = 0;
    const message = (id: string) => ({
      getAttribute: async (name: string) => (name === 'data-message-id' ? id : 'user'),
    });
    const composer = {
      isVisible: async () => true,
      fill: async () => undefined,
      press: async () => undefined,
    };
    const send = {
      isVisible: async () => true,
      click: async (options?: { trial?: boolean }) => {
        if (!options?.trial) clicks++;
      },
    };
    let metadataReads = 0;
    const target: any = {
      url: () => 'https://chatgpt.com/',
      context: () => ({ pages: () => [target] }),
      mainFrame: () => ({}),
      on: vi.fn(),
      off: vi.fn(),
      $$: async (selector: string) =>
        selector.includes('send-button')
          ? [send]
          : [message(metadataReads++ === 0 ? 'user-old' : 'user-new')],
      $: async (selector: string) => (selector.includes('prompt-textarea') ? composer : send),
      waitForTimeout: async () => undefined,
    };
    const code = buildCliOperation(
      {
        kind: 'commit',
        message: 'once',
        conversationUrl: 'https://chatgpt.com/',
        previousUserMessageId: 'user-old',
      },
      'https://chatgpt.com/',
      ['https://chatgpt.com'],
      'identity-missing',
    );
    const operation = new Function('Date', `return (${code})`)({ now: () => (clock += 6000) });
    expect(decodedOutput(await operation(target))).toEqual({
      code: 'SEND_CHECKPOINT_PERSIST_FAILED',
    });
    expect(clicks).toBe(1);
  });

  it('maps a post-confirmation CLI origin escape to checkpoint persistence failure', async () => {
    let clicks = 0;
    let currentUrl = 'https://chatgpt.com/';
    let listener: ((frame: object) => void) | undefined;
    let metadataReads = 0;
    const frame = {};
    const message = (id: string) => ({
      getAttribute: async (name: string) => (name === 'data-message-id' ? id : 'user'),
    });
    const composer = {
      isVisible: async () => true,
      fill: async () => undefined,
      press: async () => undefined,
    };
    const send = {
      isVisible: async () => true,
      click: async (options?: { trial?: boolean }) => {
        if (!options?.trial) clicks++;
      },
    };
    const target: any = {
      url: () => currentUrl,
      context: () => ({ pages: () => [target] }),
      mainFrame: () => frame,
      on: (_event: string, value: (navigated: object) => void) => (listener = value),
      off: vi.fn(),
      $$: async (selector: string) =>
        selector.includes('send-button')
          ? [send]
          : [message(metadataReads++ === 0 ? 'user-old' : 'user-new')],
      $: async (selector: string) => (selector.includes('prompt-textarea') ? composer : send),
      waitForTimeout: async () => {
        currentUrl = 'https://example.test/escape';
        listener?.(frame);
      },
    };
    const output = await executeRestricted(
      buildCliOperation(
        {
          kind: 'commit',
          message: 'once',
          conversationUrl: 'https://chatgpt.com/',
          previousUserMessageId: 'user-old',
        },
        'https://chatgpt.com/',
        ['https://chatgpt.com'],
        'post-confirmation-origin',
      ),
      target,
    );
    expect(decodedOutput(output)).toEqual({ code: 'SEND_CHECKPOINT_PERSIST_FAILED' });
    expect(clicks).toBe(1);
  });

  it('does not attempt CLI recovery for a confirmed identity persistence failure', async () => {
    const target = 'https://chatgpt.com/';
    const operations: string[] = [];
    const run = vi.fn(async (args: readonly string[]) => {
      const kind = String(args[2]).match(/"kind":"([^"]+)"/)?.[1] ?? '';
      operations.push(kind);
      const response =
        kind === 'ensure'
          ? encoded(args, { value: { conversationUrl: target } })
          : kind === 'prepare'
            ? encoded(args, { value: { conversationUrl: target } })
            : encoded(args, { code: 'SEND_CHECKPOINT_PERSIST_FAILED' }, 'ERROR');
      return { stdout: response, stderr: '' };
    });
    const session = new PlaywrightCliChatGPTSession({ run }, 'stable', target, [
      'https://chatgpt.com',
    ]);
    await session.connect();
    await expect(session.sendMessage('message')).rejects.toMatchObject({
      code: 'SEND_CHECKPOINT_PERSIST_FAILED',
    });
    expect(operations).toEqual(['ensure', 'prepare', 'commit']);
  });

  it('does not attempt CLI recovery for pre-commit send-not-ready', async () => {
    const target = 'https://chatgpt.com/c/not-ready';
    const operations: string[] = [];
    const run = vi.fn(async (args: readonly string[]) => {
      const kind = String(args[2]).match(/"kind":"([^"]+)"/)?.[1] ?? '';
      operations.push(kind);
      const response =
        kind === 'ensure'
          ? encoded(args, { value: { conversationUrl: target } })
          : kind === 'prepare'
            ? encoded(args, { value: { conversationUrl: target } })
            : encoded(args, { code: 'CHATGPT_SEND_NOT_READY' }, 'ERROR');
      return { stdout: response, stderr: '' };
    });
    const session = new PlaywrightCliChatGPTSession({ run }, 'stable', 'https://chatgpt.com/', [
      'https://chatgpt.com',
    ]);
    await session.connect({ conversationUrl: target });
    await expect(session.sendMessage('message')).rejects.toMatchObject({
      code: 'CHATGPT_SEND_NOT_READY',
    });
    expect(operations).toEqual(['ensure', 'prepare', 'commit']);
  });
  it('fails closed when a recovery candidate navigates foreign during metadata query', async () => {
    let currentUrl = 'https://chatgpt.com/c/recover';
    let listener: ((frame: object) => void) | undefined;
    let queries = 0;
    let attributeReads = 0;
    const frame = {};
    const candidate: any = {
      url: () => currentUrl,
      mainFrame: () => frame,
      on: (_event: string, value: (frame: object) => void) => (listener = value),
      off: vi.fn(),
      waitForTimeout: vi.fn(async () => undefined),
      $$: vi.fn(async () => {
        queries++;
        currentUrl = 'https://evil.example/foreign';
        listener?.(frame);
        return [
          {
            getAttribute: async () => {
              attributeReads++;
              return 'foreign-id';
            },
          },
        ];
      }),
    };
    candidate.context = () => ({ pages: () => [candidate] });
    const output = await executeRestricted(
      buildCliOperation(
        {
          kind: 'recover',
          conversationUrl: 'https://chatgpt.com/c/recover',
          previousUserMessageId: 'old',
        },
        'https://chatgpt.com/',
        ['https://chatgpt.com'],
        'race',
      ),
      candidate,
    );
    expect(decodedOutput(output)).toEqual({ code: 'ORIGIN_DENIED' });
    expect(queries).toBe(1);
    expect(attributeReads).toBe(0);
    expect(candidate.waitForTimeout).toHaveBeenCalledWith(25);
  });
  it('keeps normal allowlisted recovery behavior', async () => {
    const element = (name: string, role: string) => ({
      getAttribute: async (attribute: string) => (attribute === 'data-message-id' ? name : role),
    });
    const allowed: any = {
      url: () => 'https://chatgpt.com/c/recover',
      mainFrame: () => ({}),
      on: vi.fn(),
      off: vi.fn(),
      $$: async () => [element('new-user', 'user')],
    };
    const foreign: any = {
      url: () => 'https://example.test/',
      context: () => ({ pages: () => [foreign, allowed] }),
    };
    const operation = new Function(
      `return (${buildCliOperation(
        {
          kind: 'recover',
          conversationUrl: 'https://chatgpt.com/c/recover',
          previousUserMessageId: 'old-user',
        },
        'https://chatgpt.com/',
        ['https://chatgpt.com'],
        'normal',
      )})`,
    )();
    expect(decodedOutput(await operation(foreign))).toMatchObject({
      value: { outgoingUserMessageId: 'new-user' },
    });
  });
  it('recovers only from the exact task target when the current tab is another conversation', async () => {
    const element = (id: string) => ({
      getAttribute: async (name: string) =>
        name === 'data-message-id' ? id : name === 'data-message-author-role' ? 'user' : null,
    });
    const candidate = (url: string, id: string): any => ({
      url: () => url,
      mainFrame: () => ({}),
      on: vi.fn(),
      off: vi.fn(),
      $$: vi.fn(async () => [element(id)]),
    });
    const exact = candidate('https://chatgpt.com/c/one', 'user-one');
    const current = candidate('https://chatgpt.com/c/two', 'user-two');
    current.context = () => ({ pages: () => [current, exact] });
    const output = await executeRestricted(
      buildCliOperation(
        {
          kind: 'recover',
          conversationUrl: exact.url(),
          exactOnly: true,
          previousUserMessageId: 'user-old',
        },
        'https://chatgpt.com/',
        ['https://chatgpt.com'],
        'strict-target',
      ),
      current,
    );
    expect(decodedOutput(output)).toMatchObject({
      value: { conversationUrl: exact.url(), outgoingUserMessageId: 'user-one' },
    });
    expect(exact.$$).toHaveBeenCalledOnce();
    expect(current.$$).not.toHaveBeenCalled();
  });
  it('returns no recovery marker when the exact task target is missing', async () => {
    const current: any = {
      url: () => 'https://chatgpt.com/c/two',
      $$: vi.fn(async () => []),
    };
    current.context = () => ({ pages: () => [current] });
    const output = await executeRestricted(
      buildCliOperation(
        {
          kind: 'recover',
          conversationUrl: 'https://chatgpt.com/c/missing',
          exactOnly: true,
          previousUserMessageId: 'user-old',
        },
        'https://chatgpt.com/',
        ['https://chatgpt.com'],
        'strict-missing',
      ),
      current,
    );
    expect(decodedOutput(output)).toEqual({ value: null });
    expect(current.$$).not.toHaveBeenCalled();
  });
  it('fails before click when existing message identity capability is unavailable', async () => {
    let clicks = 0;
    const message = {
      getAttribute: async (name: string) => (name === 'data-message-author-role' ? 'user' : null),
    };
    const target: any = {
      url: () => 'https://chatgpt.com/c/precommit',
      context: () => ({ pages: () => [target] }),
      mainFrame: () => ({}),
      on: vi.fn(),
      off: vi.fn(),
      $$: async () => [message],
      $: async () => ({ click: async () => clicks++ }),
    };
    const operation = new Function(
      `return (${buildCliOperation(
        { kind: 'commit', message: 'secret', conversationUrl: target.url() },
        'https://chatgpt.com/',
        ['https://chatgpt.com'],
        'precommit',
      )})`,
    )();
    expect(decodedOutput(await operation(target))).toEqual({
      code: 'CHATGPT_MESSAGE_ID_UNAVAILABLE',
    });
    expect(clicks).toBe(0);
  });
  it('marks an outgoing-ID timeout after click as a recoverable observer failure', async () => {
    let clicks = 0;
    let clock = 0;
    const oldUser = {
      getAttribute: async (name: string) => (name === 'data-message-id' ? 'old-user' : 'user'),
    };
    const composer = {
      isVisible: async () => true,
      fill: async () => undefined,
      press: async () => undefined,
    };
    const send = {
      isVisible: async () => true,
      click: async (options?: { trial?: boolean }) => {
        if (!options?.trial) clicks++;
      },
    };
    const target: any = {
      url: () => 'https://chatgpt.com/c/postclick',
      context: () => ({ pages: () => [target] }),
      mainFrame: () => ({}),
      on: vi.fn(),
      off: vi.fn(),
      $$: async (selector: string) => (selector.includes('send-button') ? [send] : [oldUser]),
      $: async (selector: string) => (selector.includes('prompt-textarea') ? composer : send),
      waitForTimeout: async () => undefined,
    };
    const operation = new Function(
      'Date',
      `return (${buildCliOperation(
        {
          kind: 'commit',
          message: 'once',
          conversationUrl: target.url(),
          previousUserMessageId: 'old-user',
        },
        'https://chatgpt.com/',
        ['https://chatgpt.com'],
        'postclick',
      )})`,
    )({ now: () => (clock += 6000) });
    expect(decodedOutput(await operation(target))).toEqual({ code: 'SEND_OBSERVER_FAILED' });
    expect(clicks).toBe(1);
  });
  it('classifies only infrastructure timeout, session loss, and generic CLI failures', () => {
    expect(classifyCliFailure({ killed: true }).code).toBe('PLAYWRIGHT_CLI_TIMEOUT');
    expect(classifyCliFailure({ stderr: 'browser session not found' }).code).toBe(
      'PLAYWRIGHT_CLI_SESSION_LOST',
    );
    expect(classifyCliFailure({ stderr: 'source says ORIGIN_DENIED BRIDGE_TIMEOUT' }).code).toBe(
      'PLAYWRIGHT_CLI_FAILED',
    );
    expect(classifyCliFailure({ stderr: 'unexpected failure' }).code).toBe('PLAYWRIGHT_CLI_FAILED');
  });
  it('formats safe diagnostics without stderr, source, prompt, or snapshot content', () => {
    const diagnostic = formatCliDiagnostic(
      {
        code: 1,
        signal: 'SIGTERM',
        killed: false,
        stderr: 'SECRET PROMPT async page => {} ### Snapshot assistant body',
      },
      'PLAYWRIGHT_CLI_FAILED',
    );
    expect(diagnostic).toContain('exitCode=1');
    expect(diagnostic).toContain('signal=SIGTERM');
    expect(diagnostic).not.toMatch(/SECRET|async page|Snapshot|assistant body/);
  });
  it('accepts only a matching nonce and allowlisted structured bridge error', async () => {
    const run = vi.fn(async (args: readonly string[]) => ({
      stdout: `${encoded(args, { code: 'ORIGIN_DENIED' }, 'ERROR')}\nCHATBRIDGE_ERROR_wrong_${hexEnvelope({ code: 'BRIDGE_TIMEOUT' })}`,
      stderr: '',
    }));
    const session = new PlaywrightCliChatGPTSession({ run }, 't', 'https://chatgpt.com/', [
      'https://chatgpt.com',
    ]);
    await expect(session.ensureConversation()).rejects.toMatchObject({ code: 'ORIGIN_DENIED' });
  });
  it.each(['BRIDGE_TIMEOUT', 'CHATGPT_DOCUMENT_MISSING'])(
    'decodes the allowlisted %s bridge error',
    async (code) => {
      const run = vi.fn(async (args: readonly string[]) => ({
        stdout: encoded(args, { code }, 'ERROR'),
        stderr: '',
      }));
      const session = new PlaywrightCliChatGPTSession({ run }, 't', 'https://chatgpt.com/', [
        'https://chatgpt.com',
      ]);
      await expect(session.ensureConversation()).rejects.toMatchObject({ code });
    },
  );
  it('rejects mismatched nonces and unknown structured error codes', async () => {
    const mismatched = new PlaywrightCliChatGPTSession(
      {
        run: async () => ({
          stdout: `CHATBRIDGE_ERROR_wrong_${hexEnvelope({ code: 'ORIGIN_DENIED' })}`,
          stderr: '',
        }),
      },
      't',
      'https://chatgpt.com/',
      ['https://chatgpt.com'],
    );
    await expect(mismatched.ensureConversation()).rejects.toMatchObject({
      code: 'CLI_RESULT_MISSING',
    });
    const unknown = new PlaywrightCliChatGPTSession(
      {
        run: async (args) => ({
          stdout: encoded(args, { code: 'ARBITRARY_PAGE_ERROR' }, 'ERROR'),
          stderr: '',
        }),
      },
      't',
      'https://chatgpt.com/',
      ['https://chatgpt.com'],
    );
    await expect(unknown.ensureConversation()).rejects.toMatchObject({
      code: 'CLI_RESULT_INVALID',
    });
  });
  it('maps only a real CLI timeout to BridgeTimeoutError', async () => {
    const timeout = new PlaywrightCliChatGPTSession(
      {
        run: async () => {
          throw new ChatbridgeError('timeout', 'PLAYWRIGHT_CLI_TIMEOUT');
        },
      },
      't',
      'https://chatgpt.com/',
      ['https://chatgpt.com'],
    );
    await expect(
      timeout.waitForAssistantMessage({
        checkpoint: {
          conversationUrl: 'https://chatgpt.com/c/test',
          outgoingUserMessageId: 'user-id',
        },
        timeoutMs: 10,
      }),
    ).rejects.toMatchObject({ code: 'BRIDGE_TIMEOUT' });
    const lost = new PlaywrightCliChatGPTSession(
      {
        run: async () => {
          throw new ChatbridgeError('lost', 'PLAYWRIGHT_CLI_SESSION_LOST');
        },
      },
      't',
      'https://chatgpt.com/',
      ['https://chatgpt.com'],
    );
    await expect(
      lost.waitForAssistantMessage({
        checkpoint: {
          conversationUrl: 'https://chatgpt.com/c/test',
          outgoingUserMessageId: 'user-id',
        },
        timeoutMs: 10,
      }),
    ).rejects.toMatchObject({ code: 'PLAYWRIGHT_CLI_SESSION_LOST' });
  });
});
