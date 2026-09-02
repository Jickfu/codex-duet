import { describe, expect, it, vi } from 'vitest';
import { attachBrowser, type BrowserDetection } from '../../src/browser/browser-manager.js';
import { loadConfig } from '../../src/config/config.js';
import type { RuntimeSelection } from '../../src/browser/connection-types.js';
import { ChatbridgeError } from '../../src/core/errors.js';

function harness(success: (args: readonly string[]) => boolean) {
  let value: RuntimeSelection | undefined;
  let attached = false;
  let now = 0;
  const runner = {
    run: vi.fn(async (args: readonly string[]) => {
      if (args.includes('run-code') && attached)
        return (() => {
          const nonce = String(args[2]).match(/"nonce":"([^"]+)"/)?.[1];
          const payload = Buffer.from(
            encodeURIComponent(JSON.stringify({ ok: true })),
            'ascii',
          ).toString('hex');
          return { stdout: `CHATBRIDGE_RESULT_${nonce}_${payload}`, stderr: '' };
        })();
      if (args.includes('detach')) {
        attached = false;
        return { stdout: 'detached', stderr: '' };
      }
      if (success(args)) {
        attached = true;
        return { stdout: 'ok', stderr: '' };
      }
      throw new Error('unavailable');
    }),
  };
  const detection: BrowserDetection = {
    installed: vi.fn(async () => false),
    bundled: vi.fn(async () => false),
    endpoint: vi.fn(async () => false),
    open: vi.fn(async () => undefined),
  };
  const store = {
    read: vi.fn(async () => value),
    write: vi.fn(async (v: RuntimeSelection) => {
      value = v;
    }),
  };
  const timing = {
    now: vi.fn(() => now),
    delay: vi.fn(async (ms: number) => {
      now += ms;
    }),
  };
  return { runner, detection, store, timing };
}
describe('native existing-session selection', () => {
  it('prefers Chrome extension before every other runtime', async () => {
    const h = harness((args) => args.includes('--extension=chrome'));
    const result = await attachBrowser(
      loadConfig(),
      { browser: 'auto', transport: 'auto' },
      h.runner,
      h.detection,
      h.store,
      h.timing,
    );
    expect(result).toMatchObject({ mode: 'existing-extension', browser: 'chrome' });
    expect(h.runner.run).toHaveBeenCalledTimes(2);
  });
  it('falls back from unavailable extensions to Chrome channel CDP', async () => {
    const h = harness((args) => args.includes('--cdp=chrome'));
    const result = await attachBrowser(
      loadConfig(),
      { browser: 'auto', transport: 'auto' },
      h.runner,
      h.detection,
      h.store,
      h.timing,
    );
    expect(result).toMatchObject({ mode: 'existing-channel-cdp', browser: 'chrome' });
  });
  it('keeps retrying channel CDP when authorization arrives after the old five-second window', async () => {
    let attempts = 0;
    const h = harness((args) => {
      if (!args.includes('--cdp=chrome')) return false;
      attempts += 1;
      return attempts === 17;
    });
    const result = await attachBrowser(
      loadConfig(),
      { browser: 'chrome', transport: 'cdp' },
      h.runner,
      h.detection,
      h.store,
      h.timing,
    );
    expect(result).toMatchObject({ mode: 'existing-channel-cdp', browser: 'chrome' });
    expect(h.timing.delay).toHaveBeenCalledTimes(16);
    expect(h.detection.open).not.toHaveBeenCalled();
  });
  it('returns immediately when channel CDP authorization is already available', async () => {
    const h = harness((args) => args.includes('--cdp=chrome'));
    await attachBrowser(
      loadConfig(),
      { browser: 'chrome', transport: 'cdp' },
      h.runner,
      h.detection,
      h.store,
      h.timing,
    );
    expect(h.timing.delay).not.toHaveBeenCalled();
  });
  it('bounds explicit channel CDP authorization and cleans every failed attempt', async () => {
    const h = harness(() => false);
    await expect(
      attachBrowser(
        loadConfig(),
        { browser: 'chrome', transport: 'cdp' },
        h.runner,
        h.detection,
        h.store,
        h.timing,
      ),
    ).rejects.toMatchObject({ code: 'CHANNEL_CDP_AUTHORIZATION_TIMEOUT' });
    const attachCount = h.runner.run.mock.calls.filter(([args]) => args.includes('attach')).length;
    const detachCount = h.runner.run.mock.calls.filter(([args]) => args.includes('detach')).length;
    expect(attachCount).toBeGreaterThan(1);
    expect(detachCount).toBe(attachCount);
    expect(h.store.write).not.toHaveBeenCalled();
  });
  it('waits for the full channel grace before auto managed fallback', async () => {
    const h = harness(() => false);
    h.detection.installed = vi.fn(async (channel) => channel === 'chrome');
    const result = await attachBrowser(
      loadConfig(),
      { browser: 'auto', transport: 'auto' },
      h.runner,
      h.detection,
      h.store,
      h.timing,
    );
    expect(result).toMatchObject({ mode: 'managed-installed', browser: 'chrome' });
    expect(h.timing.delay).toHaveBeenCalled();
    expect(h.detection.open).toHaveBeenCalledTimes(1);
  });
  it('does not open a managed browser when auto channel CDP succeeds near the deadline', async () => {
    let chromeAttempts = 0;
    const h = harness((args) => {
      if (!args.includes('--cdp=chrome')) return false;
      chromeAttempts += 1;
      return chromeAttempts === 30;
    });
    h.detection.installed = vi.fn(async (channel) => channel === 'chrome');
    const result = await attachBrowser(
      loadConfig(),
      { browser: 'auto', transport: 'auto' },
      h.runner,
      h.detection,
      h.store,
      h.timing,
    );
    expect(result).toMatchObject({ mode: 'existing-channel-cdp', browser: 'chrome' });
    expect(h.detection.open).not.toHaveBeenCalled();
  });
  it('prefers Chrome over Edge when otherwise equal', async () => {
    const h = harness((args) => args.some((a) => a.startsWith('--extension=')));
    const result = await attachBrowser(
      loadConfig(),
      { browser: 'auto', transport: 'auto' },
      h.runner,
      h.detection,
      h.store,
      h.timing,
    );
    expect(result.browser).toBe('chrome');
  });
  it('reports explicit extension failure without managed fallback', async () => {
    const h = harness(() => false);
    await expect(
      attachBrowser(
        loadConfig(),
        { browser: 'chrome', transport: 'extension' },
        h.runner,
        h.detection,
        h.store,
        h.timing,
      ),
    ).rejects.toMatchObject({ code: 'EXTENSION_UNAVAILABLE' });
    expect(h.detection.installed).not.toHaveBeenCalled();
  });
  it('does not fallback after Extension attached but ChatGPT validation failed', async () => {
    let attached = false;
    const h = harness(() => false);
    h.runner.run = vi.fn(async (args: readonly string[]) => {
      if (args.includes('--extension=chrome')) {
        attached = true;
        return { stdout: 'attached', stderr: '' };
      }
      if (args.includes('run-code') && attached)
        throw new ChatbridgeError('adapter regression', 'CLI_RESULT_MISSING');
      if (args.includes('detach')) return { stdout: 'detached', stderr: '' };
      throw new Error('unavailable');
    });
    await expect(
      attachBrowser(
        loadConfig(),
        { browser: 'auto', transport: 'auto' },
        h.runner,
        h.detection,
        h.store,
        h.timing,
      ),
    ).rejects.toMatchObject({ code: 'CLI_RESULT_MISSING' });
    expect(h.runner.run.mock.calls.flat().join(' ')).not.toContain('--cdp=');
  });
  it('does not fallback to managed after channel CDP attached but validation failed', async () => {
    const h = harness(() => false);
    h.runner.run = vi.fn(async (args: readonly string[]) => {
      if (args.includes('--cdp=chrome')) return { stdout: 'attached', stderr: '' };
      if (args.includes('run-code'))
        throw new ChatbridgeError('session validation failed', 'PLAYWRIGHT_CLI_FAILED');
      if (args.includes('detach')) return { stdout: 'detached', stderr: '' };
      throw new Error('unavailable');
    });
    await expect(
      attachBrowser(
        loadConfig(),
        { browser: 'chrome', transport: 'auto' },
        h.runner,
        h.detection,
        h.store,
        h.timing,
      ),
    ).rejects.toMatchObject({ code: 'PLAYWRIGHT_CLI_FAILED' });
    expect(h.detection.installed).not.toHaveBeenCalled();
  });
  it('retains explicit raw CDP endpoint', async () => {
    const h = harness((args) => args.includes('--cdp=http://127.0.0.1:9333'));
    const result = await attachBrowser(
      loadConfig(),
      { browser: 'chrome', transport: 'cdp', endpoint: 'http://127.0.0.1:9333' },
      h.runner,
      h.detection,
      h.store,
      h.timing,
    );
    expect(result.mode).toBe('raw-cdp');
  });
  it('regresses to installed managed Chrome after native probes', async () => {
    const h = harness(() => false);
    h.detection.installed = vi.fn(async (channel) => channel === 'chrome');
    const result = await attachBrowser(
      loadConfig(),
      { browser: 'auto', transport: 'auto' },
      h.runner,
      h.detection,
      h.store,
      h.timing,
    );
    expect(result).toMatchObject({ mode: 'managed-installed', browser: 'chrome' });
    expect(h.detection.open).toHaveBeenCalled();
  });
  it('retains bundled fallback without installing it', async () => {
    const h = harness(() => false);
    h.detection.bundled = vi.fn(async () => true);
    const result = await attachBrowser(
      loadConfig(),
      { browser: 'auto', transport: 'auto' },
      h.runner,
      h.detection,
      h.store,
      h.timing,
    );
    expect(result.mode).toBe('bundled');
  });
});
