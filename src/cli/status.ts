import { loadConfig } from '../config/config.js';
import { isEndpointReachable } from '../browser/managed-browser.js';
import { RuntimeStore } from '../browser/runtime-store.js';
import { SessionStore } from '../core/checkpoint.js';
import path from 'node:path';
import process from 'node:process';
export async function status() {
  const c = loadConfig();
  const root = path.resolve(process.cwd(), '.chatbridge');
  const runtime = await new RuntimeStore(root).read();
  const session = await new SessionStore(path.resolve(process.cwd(), '.chatbridge')).read();
  console.log(
    JSON.stringify(
      {
        browser:
          runtime && (runtime.transport === 'cli' || (await isEndpointReachable(runtime.endpoint!)))
            ? 'running'
            : 'stopped',
        runtime: runtime ?? null,
        profileDir: c.profileDir,
        pending: session ?? null,
      },
      null,
      2,
    ),
  );
}
