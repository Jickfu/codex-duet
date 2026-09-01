import { describe, expect, it, vi } from 'vitest';
import { selectConnection, type ConnectionCandidate } from '../../src/browser/connection-types.js';
import { ExistingBrowserConnection } from '../../src/browser/existing-browser-connection.js';

const candidate = (
  mode: ConnectionCandidate['mode'],
  browser: ConnectionCandidate['browser'],
  available: boolean,
): ConnectionCandidate => ({ mode, browser, available, endpoint: `http://127.0.0.1/${browser}` });
describe('browser connection strategy', () => {
  it('prefers existing Chrome/Edge before installed and bundled', () => {
    expect(
      selectConnection([
        candidate('existing-cdp', 'chrome', true),
        candidate('managed-installed', 'chrome', true),
        candidate('bundled', 'bundled', true),
      ]).mode,
    ).toBe('existing-cdp');
  });
  it('uses installed managed browser before bundled', () => {
    expect(
      selectConnection([
        candidate('existing-cdp', 'chrome', false),
        candidate('managed-installed', 'msedge', true),
        candidate('bundled', 'bundled', true),
      ]),
    ).toMatchObject({ mode: 'managed-installed', browser: 'msedge' });
  });
  it('retains bundled Chromium as final fallback', () => {
    expect(
      selectConnection([
        candidate('managed-installed', 'chrome', false),
        candidate('bundled', 'bundled', true),
      ]).mode,
    ).toBe('bundled');
  });
  it('gives a clear browser unavailable diagnostic', () =>
    expect(() => selectConnection([candidate('bundled', 'bundled', false)])).toThrow(
      /No attachable or installed/,
    ));
  it('detach does not close an existing user browser', async () => {
    const close = vi.fn();
    const context = {};
    const connector = vi.fn(async () => ({ contexts: () => [context], close }) as any);
    const connection = new ExistingBrowserConnection('http://127.0.0.1:9222', connector as any);
    expect(await connection.connect()).toBe(context);
    await connection.close();
    expect(close).not.toHaveBeenCalled();
  });
  it('existing connection path does not inspect bundled executable', async () => {
    const connector = vi.fn(async () => ({ contexts: () => [{}] }) as any);
    await new ExistingBrowserConnection('http://127.0.0.1:9222', connector as any).connect();
    expect(connector).toHaveBeenCalledOnce();
  });
});
