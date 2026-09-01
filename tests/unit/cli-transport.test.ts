import { describe, expect, it, vi } from 'vitest';
import { PlaywrightCliChatGPTSession } from '../../src/browser/playwright-cli-session.js';
import { buildCliOperation } from '../../src/browser/chatgpt-rules.js';

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
});
