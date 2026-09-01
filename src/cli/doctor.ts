import path from 'node:path';
import process from 'node:process';
import { PlaywrightChatGPTWebAdapter } from '../browser/chatgpt-adapter.js';
import { ExistingBrowserConnection } from '../browser/existing-browser-connection.js';
import {
  detectInstalledChannel,
  endpointPages,
  isBundledInstalled,
  isEndpointReachable,
} from '../browser/managed-browser.js';
import { RuntimeStore } from '../browser/runtime-store.js';
import { loadConfig } from '../config/config.js';

export async function doctor() {
  const c = loadConfig();
  const [chromeInstalled, edgeInstalled, bundled, chromeAttach, edgeAttach, runtime] =
    await Promise.all([
      detectInstalledChannel('chrome'),
      detectInstalledChannel('msedge'),
      isBundledInstalled(),
      isEndpointReachable(c.existingChromeEndpoint),
      isEndpointReachable(c.existingEdgeEndpoint),
      new RuntimeStore(path.resolve(process.cwd(), '.chatbridge')).read(),
    ]);
  const chromePages = chromeAttach ? await endpointPages(c.existingChromeEndpoint) : [];
  const edgePages = edgeAttach ? await endpointPages(c.existingEdgeEndpoint) : [];
  let readiness = 'not checked';
  if (runtime && (await isEndpointReachable(runtime.endpoint))) {
    try {
      const connection = new ExistingBrowserConnection(runtime.endpoint);
      const adapter = new PlaywrightChatGPTWebAdapter(
        await connection.connect(),
        c.chatgptUrl,
        3000,
        c.debug,
        c.allowedOrigins,
      );
      await adapter.connect();
      readiness = (await adapter.isLoggedIn()) ? 'ready' : 'manual login required';
      await connection.close();
    } catch {
      readiness = 'attached runtime is not ready';
    }
  }
  console.log(`Detected Chrome: ${chromeInstalled ? 'yes' : 'no'}`);
  console.log(`Detected Edge: ${edgeInstalled ? 'yes' : 'no'}`);
  console.log(
    `Existing Chrome attachment: ${chromeAttach ? 'available' : 'unavailable'}; ChatGPT tab: ${hasChatGPT(chromePages) ? 'yes' : 'no'}`,
  );
  console.log(
    `Existing Edge attachment: ${edgeAttach ? 'available' : 'unavailable'}; ChatGPT tab: ${hasChatGPT(edgePages) ? 'yes' : 'no'}`,
  );
  console.log(`Selected mode: ${runtime?.mode ?? 'none'}`);
  console.log(`Selected browser: ${runtime?.browser ?? 'none'}`);
  console.log(`ChatGPT session: ${readiness}`);
  console.log(`Bundled Chromium: ${bundled ? 'installed' : 'not installed'}`);
  console.log(
    'Extension transport: official Agent CLI only; BrowserContext integration unavailable',
  );
}
function hasChatGPT(urls: string[]) {
  return urls.some((url) => {
    try {
      return new URL(url).origin === 'https://chatgpt.com';
    } catch {
      return false;
    }
  });
}
