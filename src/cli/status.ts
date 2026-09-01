import { loadConfig } from '../config/config.js';
import { isBrowserReachable } from '../browser/managed-browser.js';
import { SessionStore } from '../core/checkpoint.js';
import path from 'node:path';
import process from 'node:process';
export async function status() {
  const c = loadConfig();
  const session = await new SessionStore(path.resolve(process.cwd(), '.chatbridge')).read();
  console.log(
    JSON.stringify(
      {
        browser: (await isBrowserReachable(c.cdpPort)) ? 'running' : 'stopped',
        profileDir: c.profileDir,
        pending: session ?? null,
      },
      null,
      2,
    ),
  );
}
