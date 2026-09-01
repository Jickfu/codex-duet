import { chromium } from 'playwright';
import { access } from 'node:fs/promises';
import { loadConfig } from '../config/config.js';
import { isBrowserReachable } from '../browser/managed-browser.js';
import { PlaywrightConnection } from '../browser/playwright-connection.js';
import { PlaywrightChatGPTWebAdapter } from '../browser/chatgpt-adapter.js';
export async function doctor() {
  const c = loadConfig();
  let installed = true;
  try {
    await access(chromium.executablePath());
  } catch {
    installed = false;
  }
  const running = await isBrowserReachable(c.cdpPort);
  let login = 'unknown (browser stopped)';
  if (running) {
    const connection = new PlaywrightConnection(c.cdpPort);
    const adapter = new PlaywrightChatGPTWebAdapter(await connection.connect(), c.chatgptUrl, 3000);
    await adapter.connect();
    login = (await adapter.isLoggedIn()) ? 'ready' : 'manual login required';
    await connection.close();
  }
  console.log(`Node: ${process.versions.node} (required >=20)`);
  console.log(`Playwright Chromium: ${installed ? 'installed' : 'missing'}`);
  console.log(`Managed browser: ${running ? 'running' : 'stopped'}`);
  console.log(`ChatGPT session: ${login}`);
  if (!installed) throw new Error('Install Chromium with `pnpm exec playwright install chromium`.');
}
