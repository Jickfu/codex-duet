import { chromium } from 'playwright';

const payload = JSON.parse(Buffer.from(process.argv[2] ?? '', 'base64url').toString('utf8')) as {
  channel: 'chrome' | 'msedge' | 'chromium';
  profileDir: string;
  port: number;
  url: string;
};
const context = await chromium.launchPersistentContext(payload.profileDir, {
  channel: payload.channel,
  headless: false,
  args: [
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${payload.port}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
});
const pages = context.pages();
if (!pages.some((page) => page.url().startsWith(payload.url)))
  await (pages[0] ?? (await context.newPage())).goto(payload.url);
const stop = async () => {
  await context.close().catch(() => undefined);
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
await new Promise<void>((resolve) => context.on('close', () => resolve()));
