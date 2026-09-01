import path from 'node:path';
import process from 'node:process';
import { loadConfig } from '../config/config.js';
import { PlaywrightConnection } from '../browser/playwright-connection.js';
import { RuntimeStore } from '../browser/runtime-store.js';
import { PlaywrightCliRunner } from '../browser/playwright-cli-runner.js';
import { PlaywrightCliChatGPTSession } from '../browser/playwright-cli-session.js';
import { LibraryChatGPTSession } from '../browser/library-chatgpt-session.js';
import { SessionStore } from '../core/checkpoint.js';
import type { BrowserConnectOptions } from '../browser/browser-automation-session.js';

export async function runtime(options: BrowserConnectOptions = {}) {
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
    const browserSelection = await adapter.connect(options);
    return {
      config,
      connection: { close: async () => undefined },
      adapter,
      selection: browserSelection,
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
  const browserSelection = await adapter.connect(options);
  return {
    config,
    connection,
    adapter,
    selection: browserSelection,
    store: new SessionStore(path.resolve(process.cwd(), '.chatbridge')),
  };
}
