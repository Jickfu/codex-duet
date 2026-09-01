import { describe, expect, it, vi } from 'vitest';
import { attachBrowser, type BrowserDetection } from '../../src/browser/browser-manager.js';
import { loadConfig } from '../../src/config/config.js';
import type { RuntimeSelection } from '../../src/browser/connection-types.js';

function harness(success: (args: readonly string[]) => boolean) {
  let value: RuntimeSelection | undefined;
  let attached = false;
  const runner = {
    run: vi.fn(async (args: readonly string[]) => {
      if (args.includes('run-code') && attached)
        return {
          stdout: `CHATBRIDGE_RESULT_${Buffer.from(JSON.stringify({ ok: true })).toString('base64')}`,
          stderr: '',
        };
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
  return { runner, detection, store };
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
    );
    expect(result).toMatchObject({ mode: 'existing-channel-cdp', browser: 'chrome' });
  });
  it('prefers Chrome over Edge when otherwise equal', async () => {
    const h = harness((args) => args.some((a) => a.startsWith('--extension=')));
    const result = await attachBrowser(
      loadConfig(),
      { browser: 'auto', transport: 'auto' },
      h.runner,
      h.detection,
      h.store,
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
      ),
    ).rejects.toMatchObject({ code: 'EXTENSION_UNAVAILABLE' });
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
    );
    expect(result.mode).toBe('bundled');
  });
});
