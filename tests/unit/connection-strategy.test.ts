import { describe, expect, it } from 'vitest';
import { selectConnection, type ConnectionCandidate } from '../../src/browser/connection-types.js';

const candidate = (
  mode: ConnectionCandidate['mode'],
  browser: ConnectionCandidate['browser'],
  available: boolean,
): ConnectionCandidate => ({ mode, browser, available, endpoint: `http://127.0.0.1/${browser}` });
describe('browser connection strategy', () => {
  it('prefers existing Chrome/Edge before installed and bundled', () => {
    expect(
      selectConnection([
        candidate('existing-extension', 'chrome', true),
        candidate('managed-installed', 'chrome', true),
        candidate('bundled', 'bundled', true),
      ]).mode,
    ).toBe('existing-extension');
  });
  it('uses installed managed browser before bundled', () => {
    expect(
      selectConnection([
        candidate('existing-channel-cdp', 'chrome', false),
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
});
