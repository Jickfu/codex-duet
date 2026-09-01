import path from 'node:path';
import process from 'node:process';
import { loadConfig } from '../config/config.js';
import { PlaywrightConnection } from '../browser/playwright-connection.js';
import { PlaywrightChatGPTWebAdapter } from '../browser/chatgpt-adapter.js';
import { SessionStore } from '../core/checkpoint.js';
export async function runtime() {
  const config = loadConfig();
  const connection = new PlaywrightConnection(config.cdpPort);
  const context = await connection.connect();
  const adapter = new PlaywrightChatGPTWebAdapter(
    context,
    config.chatgptUrl,
    config.timeoutMs,
    config.debug,
  );
  await adapter.connect();
  return {
    config,
    connection,
    adapter,
    store: new SessionStore(path.resolve(process.cwd(), '.chatbridge')),
  };
}
