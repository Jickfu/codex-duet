import path from 'node:path';
import process from 'node:process';
import { loadConfig } from '../config/config.js';
import { PlaywrightConnection } from '../browser/playwright-connection.js';
import { RuntimeStore } from '../browser/runtime-store.js';
import { PlaywrightCliRunner } from '../browser/playwright-cli-runner.js';
import { PlaywrightCliChatGPTSession } from '../browser/playwright-cli-session.js';
import { LibraryChatGPTSession } from '../browser/library-chatgpt-session.js';
import { SessionStore } from '../core/checkpoint.js';
export async function runtime() {
  const config = loadConfig();
  const selection = await new RuntimeStore(path.resolve(process.cwd(), '.chatbridge')).read();
  if (!selection) throw new Error('No browser is attached. Run `chatbridge browser attach` first.');
  if (selection.transport === 'cli') {
    const adapter = new PlaywrightCliChatGPTSession(
      new PlaywrightCliRunner(),
      selection.session!,
      config.chatgptUrl,
      config.allowedOrigins,
      config.timeoutMs,
    );
    await adapter.connect();
    return {
      config,
      connection: { close: async () => undefined },
      adapter,
      store: new SessionStore(path.resolve(process.cwd(), '.chatbridge')),
    };
  }
  const connection = new PlaywrightConnection(Number(new URL(selection.endpoint!).port));
  const adapter = new LibraryChatGPTSession(
    connection,
    config.chatgptUrl,
    config.allowedOrigins,
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
