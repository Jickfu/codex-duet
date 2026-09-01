#!/usr/bin/env node
import { Command, Option } from 'commander';
import { attachBrowser } from '../browser/browser-manager.js';
import type { BrowserKind, TransportKind } from '../browser/connection-types.js';
import { loadConfig } from '../config/config.js';
import { send } from './send.js';
import { wait } from './wait.js';
import { status } from './status.js';
import { doctor } from './doctor.js';
import { detach } from './detach.js';
const program = new Command()
  .name('chatbridge')
  .description('Deterministic ChatGPT Web browser bridge')
  .version('0.1.2')
  .option('--debug', 'print bridge diagnostics without authentication data')
  .hook('preAction', (command) => {
    if (command.opts().debug) process.env.CHATBRIDGE_DEBUG = '1';
  });
const browser = program.command('browser').description('Manage the isolated browser');
browser
  .command('open')
  .description('Compatibility alias for browser attach')
  .action(async () => {
    console.log(await attachBrowser(loadConfig(), { browser: 'auto', transport: 'auto' }));
  });
browser
  .command('attach')
  .description('Attach existing Chrome/Edge or start a dedicated managed fallback')
  .addOption(
    new Option('--browser <browser>')
      .choices(['auto', 'chrome', 'msedge', 'bundled'])
      .default('auto'),
  )
  .addOption(
    new Option('--transport <transport>').choices(['auto', 'extension', 'cdp']).default('auto'),
  )
  .option('--endpoint <url>', 'explicit existing-browser CDP endpoint')
  .action(async (o: { browser: BrowserKind; transport: TransportKind; endpoint?: string }) => {
    const selected = await attachBrowser(loadConfig(), o);
    console.log(JSON.stringify(selected, null, 2));
    if (selected.mode === 'managed-installed' || selected.mode === 'bundled')
      console.log('Log in to ChatGPT manually in the dedicated browser profile if needed.');
  });
browser
  .command('doctor')
  .description('Check local browser prerequisites')
  .option('--endpoint <url>', 'raw CDP endpoint to diagnose')
  .action(doctor);
browser
  .command('detach')
  .description('Detach without closing an existing user browser')
  .action(detach);
program
  .command('send')
  .requiredOption('--message-file <path>')
  .action((o: { messageFile: string }) => send(o.messageFile));
program
  .command('wait')
  .option('--parse', 'parse and validate C2C/1')
  .option('--timeout <ms>', 'timeout in milliseconds', Number)
  .action((o: { parse?: boolean; timeout?: number }) => wait(Boolean(o.parse), o.timeout));
program.command('status').action(status);
program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
