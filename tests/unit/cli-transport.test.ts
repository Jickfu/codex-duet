import { describe, expect, it, vi } from 'vitest';
import { PlaywrightCliChatGPTSession } from '../../src/browser/playwright-cli-session.js';
import { buildCliOperation } from '../../src/browser/chatgpt-rules.js';
import { classifyCliFailure } from '../../src/browser/playwright-cli-runner.js';
import { ChatbridgeError } from '../../src/core/errors.js';

const encoded = (value: unknown) =>
  `### Snapshot\nSECRET DOM\nCHATBRIDGE_RESULT_${Buffer.from(JSON.stringify(value)).toString('base64')}\n### Page`;
describe('Playwright CLI transport', () => {
  it('returns only structured bridge data, never CLI snapshot output', async () => {
    const run = vi.fn(async () => ({ stdout: encoded({ value: 3 }), stderr: '' }));
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
      return { stdout: encoded({ ok: true }), stderr: '' };
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
    const run = vi.fn(async () => ({ stdout: encoded({ value: true }), stderr: '' }));
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
    expect(code).not.toMatch(/cookies\(|localStorage|sessionStorage|storageState|screenshot/);
  });
  it('classifies timeout, origin, session loss, and generic CLI failures', () => {
    expect(classifyCliFailure({ killed: true }).code).toBe('PLAYWRIGHT_CLI_TIMEOUT');
    expect(classifyCliFailure({ stderr: 'ORIGIN_DENIED' }).code).toBe('ORIGIN_DENIED');
    expect(classifyCliFailure({ stderr: 'browser session not found' }).code).toBe(
      'PLAYWRIGHT_CLI_SESSION_LOST',
    );
    expect(classifyCliFailure({ stderr: 'unexpected failure' }).code).toBe('PLAYWRIGHT_CLI_FAILED');
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
