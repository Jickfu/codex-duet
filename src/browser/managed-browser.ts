import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChatbridgeError } from '../core/errors.js';
import type { Config } from '../config/schema.js';
import type { BrowserKind } from './connection-types.js';

export async function isEndpointReachable(endpoint: string) {
  try {
    const r = await fetch(`${endpoint}/json/version`, {
      signal: AbortSignal.timeout(1000),
    });
    return r.ok;
  } catch {
    return false;
  }
}
export async function endpointPages(endpoint: string): Promise<string[]> {
  try {
    const r = await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(800) });
    if (!r.ok) return [];
    const rows = (await r.json()) as Array<{ url?: unknown }>;
    return rows.flatMap(({ url }) => (typeof url === 'string' ? [url] : []));
  } catch {
    return [];
  }
}
export async function detectInstalledChannel(channel: 'chrome' | 'msedge'): Promise<boolean> {
  let browser;
  try {
    browser = await chromium.launch({ channel, headless: true });
    return true;
  } catch {
    return false;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
export async function isBundledInstalled() {
  try {
    await access(chromium.executablePath());
    return true;
  } catch {
    return false;
  }
}
export async function openManagedBrowser(
  config: Config,
  browser: Exclude<BrowserKind, 'auto'> = 'bundled',
): Promise<'opened' | 'already-running'> {
  const endpoint = `http://127.0.0.1:${config.cdpPort}`;
  if (await isEndpointReachable(endpoint)) return 'already-running';
  if (browser === 'bundled' && !(await isBundledInstalled()))
    throw new ChatbridgeError(
      'Bundled Chromium is not installed. Run `pnpm exec playwright install chromium` only for this fallback.',
      'BUNDLED_BROWSER_MISSING',
    );
  const channel = browser === 'bundled' ? 'chromium' : browser;
  const profileDir = path.join(config.profileDir, browser);
  await mkdir(profileDir, { recursive: true });
  const worker = fileURLToPath(new URL('./managed-worker.js', import.meta.url));
  const payload = Buffer.from(
    JSON.stringify({ channel, profileDir, port: config.cdpPort, url: config.chatgptUrl }),
  ).toString('base64url');
  const child = spawn(process.execPath, [worker, payload], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await isEndpointReachable(endpoint)) return 'opened';
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new ChatbridgeError(
    `Failed to start ${browser} with a dedicated codex-duet profile.`,
    'BROWSER_START_FAILED',
  );
}
export async function isBrowserReachable(port: number) {
  return isEndpointReachable(`http://127.0.0.1:${port}`);
}
