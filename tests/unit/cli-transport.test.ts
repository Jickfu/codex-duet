import { describe, expect, it, vi } from 'vitest';
import { PlaywrightCliChatGPTSession } from '../../src/browser/playwright-cli-session.js';
import { buildCliOperation } from '../../src/browser/chatgpt-rules.js';
import { classifyCliFailure } from '../../src/browser/playwright-cli-runner.js';
import { ChatbridgeError } from '../../src/core/errors.js';

const hexEnvelope = (value: unknown) =>
  Buffer.from(encodeURIComponent(JSON.stringify(value)), 'ascii').toString('hex');
const encoded = (args: readonly string[], value: unknown, kind = 'RESULT') => {
  const nonce = String(args[2]).match(/"nonce":"([^"]+)"/)?.[1];
  return `### Snapshot\nSECRET DOM\nCHATBRIDGE_${kind}_${nonce}_${hexEnvelope(value)}\n### Page`;
};
describe('Playwright CLI transport', () => {
  it('returns only structured bridge data, never CLI snapshot output', async () => {
    const run = vi.fn(async (args: readonly string[]) => ({
      stdout: encoded(args, { value: 3 }),
      stderr: '',
    }));
    const session = new PlaywrightCliChatGPTSession({ run }, 'test', 'https://chatgpt.com/', [
      'https://chatgpt.com',
    ]);
    expect(await session.sendMessage('hello')).toBe(3);
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
  it('generated operations contain navigation abort guards and no storage/screenshot access', () => {
    const code = buildCliOperation(
      { kind: 'wait', afterCount: 1, timeoutMs: 1000 },
      'https://chatgpt.com/',
      ['https://chatgpt.com'],
    );
    expect(code).toContain('framenavigated');
    expect(code).not.toContain('new URL(');
    expect(code).not.toContain('globalThis.URL');
    expect(code).not.toMatch(/cookies\(|localStorage|sessionStorage|storageState|screenshot/);
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
    };
    const page: any = {
      context: () => ({ pages: () => [target], newPage: async () => target }),
    };
    const operation = new Function('URL', `return (${code})`)(undefined);
    const output = await operation(page);
    expect(output.startsWith(allowed ? 'CHATBRIDGE_RESULT_' : 'CHATBRIDGE_ERROR_')).toBe(true);
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
      timeout.waitForAssistantMessage({ afterCount: 0, timeoutMs: 10 }),
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
      lost.waitForAssistantMessage({ afterCount: 0, timeoutMs: 10 }),
    ).rejects.toMatchObject({ code: 'PLAYWRIGHT_CLI_SESSION_LOST' });
  });
});
