import path from 'node:path';
import process from 'node:process';
import { loadConfig } from '../config/config.js';
import { ExistingBrowserConnection } from '../browser/existing-browser-connection.js';
import { RuntimeStore } from '../browser/runtime-store.js';
import { PlaywrightChatGPTWebAdapter } from '../browser/chatgpt-adapter.js';
import { SessionStore } from '../core/checkpoint.js';
export async function runtime() {
  const config = loadConfig();
  const selection = await new RuntimeStore(path.resolve(process.cwd(), '.chatbridge')).read();
  if (!selection) throw new Error('No browser is attached. Run `chatbridge browser attach` first.');
  const connection = new ExistingBrowserConnection(selection.endpoint);
  const context = await connection.connect();
  const adapter = new PlaywrightChatGPTWebAdapter(
    context,
    config.chatgptUrl,
    config.timeoutMs,
    config.debug,
    config.allowedOrigins,
  );
  await adapter.connect();
  return {
    config,
    connection,
    adapter,
    store: new SessionStore(path.resolve(process.cwd(), '.chatbridge')),
  };
}
