import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { ChatbridgeError } from '../core/errors.js';
import type { Config } from '../config/schema.js';

async function reachable(port: number) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1000),
    });
    return r.ok;
  } catch {
    return false;
  }
}
export async function openManagedBrowser(config: Config): Promise<'opened' | 'already-running'> {
  if (await reachable(config.cdpPort)) return 'already-running';
  await mkdir(config.profileDir, { recursive: true });
  const executable = chromium.executablePath();
  const child = spawn(
    executable,
    [
      `--user-data-dir=${config.profileDir}`,
      `--remote-debugging-port=${config.cdpPort}`,
      '--no-first-run',
      '--no-default-browser-check',
      config.chatgptUrl,
    ],
    { detached: true, stdio: 'ignore', windowsHide: false },
  );
  child.unref();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await reachable(config.cdpPort)) return 'opened';
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new ChatbridgeError(
    'Browser did not start. Run `pnpm exec playwright install chromium` and retry.',
    'BROWSER_START_FAILED',
  );
}
export { reachable as isBrowserReachable };
