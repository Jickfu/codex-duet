import path from 'node:path';
import process from 'node:process';
import type { Config } from '../config/schema.js';
import { ChatbridgeError } from '../core/errors.js';
import type {
  BrowserKind,
  ConnectionCandidate,
  RuntimeSelection,
  TransportKind,
} from './connection-types.js';
import { selectConnection } from './connection-types.js';
import {
  detectInstalledChannel,
  endpointPages,
  isBundledInstalled,
  isEndpointReachable,
  openManagedBrowser,
} from './managed-browser.js';
import { RuntimeStore } from './runtime-store.js';

export interface AttachOptions {
  browser: BrowserKind;
  transport: TransportKind;
  endpoint?: string;
}
const enabled = (requested: BrowserKind, target: 'chrome' | 'msedge' | 'bundled') =>
  requested === 'auto' || requested === target;
export async function attachBrowser(
  config: Config,
  options: AttachOptions,
): Promise<RuntimeSelection> {
  if (options.transport === 'extension')
    throw new ChatbridgeError(
      'Playwright Extension attachment is exposed through Playwright Agent CLI, not the BrowserContext library API required by ChatGPTWebAdapter. Use --transport cdp with a public remote-debugging endpoint.',
      'EXTENSION_TRANSPORT_UNAVAILABLE',
    );
  const chromeEndpoint = options.endpoint ?? config.existingChromeEndpoint;
  const edgeEndpoint = options.endpoint ?? config.existingEdgeEndpoint;
  const existing = await Promise.all([
    probeExisting('chrome', chromeEndpoint, enabled(options.browser, 'chrome')),
    probeExisting('msedge', edgeEndpoint, enabled(options.browser, 'msedge')),
  ]);
  existing.sort((a, b) => Number(b.hasChatgpt) - Number(a.hasChatgpt));
  const found = existing.find((item) => item.candidate.available);
  let selected: ConnectionCandidate;
  if (found) selected = found.candidate;
  else {
    if (options.endpoint)
      throw new ChatbridgeError(
        `No browser is attachable at ${options.endpoint}`,
        'BROWSER_UNAVAILABLE',
      );
    const chrome = enabled(options.browser, 'chrome') && (await detectInstalledChannel('chrome'));
    const edge = enabled(options.browser, 'msedge') && (await detectInstalledChannel('msedge'));
    const bundled = enabled(options.browser, 'bundled') && (await isBundledInstalled());
    selected = selectConnection([
      {
        mode: 'managed-installed',
        browser: 'chrome',
        available: chrome,
        endpoint: `http://127.0.0.1:${config.cdpPort}`,
      },
      {
        mode: 'managed-installed',
        browser: 'msedge',
        available: edge,
        endpoint: `http://127.0.0.1:${config.cdpPort}`,
      },
      {
        mode: 'bundled',
        browser: 'bundled',
        available: bundled,
        endpoint: `http://127.0.0.1:${config.cdpPort}`,
      },
    ]);
    await openManagedBrowser(config, selected.browser);
  }
  const runtime = {
    mode: selected.mode,
    browser: selected.browser,
    endpoint: selected.endpoint,
    attachedAt: new Date().toISOString(),
  } satisfies RuntimeSelection;
  await new RuntimeStore(path.resolve(process.cwd(), '.chatbridge')).write(runtime);
  return runtime;
}
async function probeExisting(browser: 'chrome' | 'msedge', endpoint: string, isEnabled: boolean) {
  if (!isEnabled)
    return {
      candidate: { mode: 'existing-cdp' as const, browser, available: false, endpoint },
      hasChatgpt: false,
    };
  const available = await isEndpointReachable(endpoint);
  const pages = available ? await endpointPages(endpoint) : [];
  return {
    candidate: { mode: 'existing-cdp' as const, browser, available, endpoint },
    hasChatgpt: pages.some((url) => {
      try {
        return new URL(url).origin === 'https://chatgpt.com';
      } catch {
        return false;
      }
    }),
  };
}
