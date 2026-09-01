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
      $$: async () => [message(metadataReads++ < 2 ? 'user-old' : 'user-new')],
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
      click: async () => {
        clicks++;
      },
    };
    const target: any = {
      url: () => 'https://chatgpt.com/c/postclick',
      context: () => ({ pages: () => [target] }),
      mainFrame: () => ({}),
      on: vi.fn(),
      off: vi.fn(),
      $$: async () => [oldUser],
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
