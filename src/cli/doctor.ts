import path from 'node:path';
import process from 'node:process';
import {
  detectInstalledChannel,
  isBundledInstalled,
  isEndpointReachable,
} from '../browser/managed-browser.js';
import {
  PlaywrightCliRunner,
  type PlaywrightCliRunnerLike,
} from '../browser/playwright-cli-runner.js';
import { RuntimeStore } from '../browser/runtime-store.js';

export async function doctor(options: { endpoint?: string } = {}) {
  const runner = new PlaywrightCliRunner();
  const chromeExtension = await probe(runner, 'doctor-ext-chrome', '--extension=chrome');
  const edgeExtension = await probe(runner, 'doctor-ext-edge', '--extension=msedge');
  const chromeChannel = await probe(runner, 'doctor-cdp-chrome', '--cdp=chrome');
  const edgeChannel = await probe(runner, 'doctor-cdp-edge', '--cdp=msedge');
  const [chromeInstalled, edgeInstalled, bundled, runtime] = await Promise.all([
    detectInstalledChannel('chrome'),
    detectInstalledChannel('msedge'),
    isBundledInstalled(),
    new RuntimeStore(path.resolve(process.cwd(), '.chatbridge')).read(),
  ]);
  const raw = options.endpoint ? await isEndpointReachable(options.endpoint) : undefined;
  const recommended = chromeExtension
    ? 'extension/chrome'
    : edgeExtension
      ? 'extension/msedge'
      : chromeChannel
        ? 'cdp/chrome'
        : edgeChannel
          ? 'cdp/msedge'
          : chromeInstalled
            ? 'managed/chrome'
            : edgeInstalled
              ? 'managed/msedge'
              : bundled
                ? 'bundled'
                : 'unavailable';
  console.log(
    `Extension Chrome: ${chromeExtension ? 'available (session not validated)' : 'unavailable'}`,
  );
  console.log(
    `Extension Edge: ${edgeExtension ? 'available (session not validated)' : 'unavailable'}`,
  );
  console.log(
    `Channel CDP Chrome: ${chromeChannel ? 'available (session not validated)' : 'not validated / authorization may be required'}`,
  );
  console.log(
    `Channel CDP Edge: ${edgeChannel ? 'available (session not validated)' : 'not validated / authorization may be required'}`,
  );
  console.log(
    `Raw CDP endpoint: ${options.endpoint ? `${options.endpoint} ${raw ? 'reachable' : 'unreachable'}` : 'not specified'}`,
  );
  console.log(`Managed Chrome: ${chromeInstalled ? 'installed' : 'missing'}`);
  console.log(`Managed Edge: ${edgeInstalled ? 'installed' : 'missing'}`);
  console.log(`Bundled Chromium: ${bundled ? 'installed' : 'not installed'}`);
  console.log(`Selected runtime: ${runtime?.mode ?? 'none'}`);
  console.log(`Recommended runtime: ${recommended}`);
  console.log(
    `ChatGPT session: ${runtime ? 'not tested (run status or attach for validation)' : 'not tested'}`,
  );
  console.log(
    'Installed-browser detection uses a short official Playwright channel launch probe; it closes the temporary browser and profile immediately.',
  );
}
async function probe(runner: PlaywrightCliRunnerLike, session: string, argument: string) {
  try {
    await runner.run([`--session=${session}`, 'attach', argument], 3000);
    await runner.run([`--session=${session}`, 'detach'], 3000).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
