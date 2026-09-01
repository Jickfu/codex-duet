import { createHash } from 'node:crypto';
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
  isBundledInstalled,
  isEndpointReachable,
  openManagedBrowser,
} from './managed-browser.js';
import { PlaywrightCliRunner, type PlaywrightCliRunnerLike } from './playwright-cli-runner.js';
import { PlaywrightCliChatGPTSession } from './playwright-cli-session.js';
import { RuntimeStore } from './runtime-store.js';

export interface AttachOptions {
  browser: BrowserKind;
  transport: TransportKind;
  endpoint?: string;
}
export interface BrowserDetection {
  installed(channel: 'chrome' | 'msedge'): Promise<boolean>;
  bundled(): Promise<boolean>;
  endpoint(url: string): Promise<boolean>;
  open(config: Config, browser: 'chrome' | 'msedge' | 'bundled'): Promise<unknown>;
}
const defaultDetection: BrowserDetection = {
  installed: detectInstalledChannel,
  bundled: isBundledInstalled,
  endpoint: isEndpointReachable,
  open: openManagedBrowser,
};
const enabled = (requested: BrowserKind, target: 'chrome' | 'msedge' | 'bundled') =>
  requested === 'auto' || requested === target;
const channels = (browser: BrowserKind) => [
  ...(enabled(browser, 'chrome') ? ['chrome' as const] : []),
  ...(enabled(browser, 'msedge') ? ['msedge' as const] : []),
];

export async function attachBrowser(
  config: Config,
  options: AttachOptions,
  runner: PlaywrightCliRunnerLike = new PlaywrightCliRunner(),
  detection: BrowserDetection = defaultDetection,
  store: Pick<RuntimeStore, 'read' | 'write'> = new RuntimeStore(
    path.resolve(process.cwd(), '.chatbridge'),
  ),
): Promise<RuntimeSelection> {
  const session = sessionName();
  const save = async (runtime: RuntimeSelection) => {
    await store.write(runtime);
    return runtime;
  };
  const previous = await store.read();
  if (previous?.transport === 'cli')
    await runner.run([`--session=${previous.session!}`, 'detach'], 5000).catch(() => undefined);
  if (options.browser === 'bundled' && (options.transport === 'extension' || options.endpoint))
    throw new ChatbridgeError(
      'Bundled browser cannot be selected as an existing-browser transport',
      'INVALID_BROWSER_TRANSPORT',
    );
  if (!options.endpoint && (options.transport === 'auto' || options.transport === 'extension')) {
    for (const browser of channels(options.browser)) {
      if (await tryCliAttach(runner, session, `--extension=${browser}`, config))
        return save({
          mode: 'existing-extension',
          browser,
          transport: 'cli',
          session,
          attachedAt: new Date().toISOString(),
        });
    }
    if (options.transport === 'extension')
      throw new ChatbridgeError(
        `Playwright Extension is not available for ${options.browser === 'auto' ? 'Chrome or Edge' : options.browser}. Install/enable the official extension and keep the browser running.`,
        'EXTENSION_UNAVAILABLE',
      );
  }
  if (!options.endpoint && (options.transport === 'auto' || options.transport === 'cdp')) {
    for (const browser of channels(options.browser)) {
      if (await tryCliAttach(runner, session, `--cdp=${browser}`, config))
        return save({
          mode: 'existing-channel-cdp',
          browser,
          transport: 'cli',
          session,
          attachedAt: new Date().toISOString(),
        });
    }
    if (options.transport === 'cdp')
      throw new ChatbridgeError(
        `Channel CDP is not authorized for ${options.browser}. Enable remote debugging at chrome://inspect/#remote-debugging.`,
        'CHANNEL_CDP_UNAVAILABLE',
      );
  }
  if (options.endpoint) {
    if (await tryCliAttach(runner, session, `--cdp=${options.endpoint}`, config))
      return save({
        mode: 'raw-cdp',
        browser: options.browser === 'msedge' ? 'msedge' : 'chrome',
        transport: 'cli',
        session,
        attachedAt: new Date().toISOString(),
      });
    throw new ChatbridgeError(
      `Raw CDP endpoint is unreachable: ${options.endpoint}`,
      'RAW_CDP_UNAVAILABLE',
    );
  }
  const chrome = enabled(options.browser, 'chrome') && (await detection.installed('chrome'));
  const edge = enabled(options.browser, 'msedge') && (await detection.installed('msedge'));
  const bundled = enabled(options.browser, 'bundled') && (await detection.bundled());
  const selected = selectConnection([
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
  ] satisfies ConnectionCandidate[]);
  await detection.open(config, selected.browser);
  return save({
    mode: selected.mode,
    browser: selected.browser,
    transport: 'library',
    endpoint: selected.endpoint,
    attachedAt: new Date().toISOString(),
  });
}
async function tryCliAttach(
  runner: PlaywrightCliRunnerLike,
  session: string,
  argument: string,
  config: Config,
) {
  try {
    await runner.run([`--session=${session}`, 'attach', argument], 5000);
    await new PlaywrightCliChatGPTSession(
      runner,
      session,
      config.chatgptUrl,
      config.allowedOrigins,
      config.timeoutMs,
    ).ensureConversation();
    return true;
  } catch {
    await runner.run([`--session=${session}`, 'detach'], 3000).catch(() => undefined);
    return false;
  }
}
function sessionName() {
  return `codex-duet-${createHash('sha256').update(process.cwd()).digest('hex').slice(0, 12)}`;
}
