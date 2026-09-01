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
  console.log(`Extension Chrome: ${chromeExtension ? 'available' : 'unavailable'}`);
  console.log(`Extension Edge: ${edgeExtension ? 'available' : 'unavailable'}`);
  console.log(`Channel CDP Chrome: ${chromeChannel ? 'attachable' : 'not authorized'}`);
  console.log(`Channel CDP Edge: ${edgeChannel ? 'attachable' : 'not authorized'}`);
  console.log(
    `Raw CDP endpoint: ${options.endpoint ? `${options.endpoint} ${raw ? 'reachable' : 'unreachable'}` : 'not specified'}`,
  );
  console.log(`Managed Chrome installed: ${chromeInstalled ? 'yes' : 'no'}`);
  console.log(`Managed Edge installed: ${edgeInstalled ? 'yes' : 'no'}`);
  console.log(`Bundled Chromium: ${bundled ? 'installed' : 'not installed'}`);
  console.log(`Selected mode: ${runtime?.mode ?? 'none'}`);
  console.log(`Recommended mode: ${recommended}`);
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
