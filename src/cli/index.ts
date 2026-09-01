#!/usr/bin/env node
import { Command } from 'commander';
import { openManagedBrowser } from '../browser/managed-browser.js';
import { loadConfig } from '../config/config.js';
import { send } from './send.js';
import { wait } from './wait.js';
import { status } from './status.js';
import { doctor } from './doctor.js';
const program = new Command()
  .name('chatbridge')
  .description('Deterministic ChatGPT Web browser bridge')
  .version('0.1.0')
  .option('--debug', 'print bridge diagnostics without authentication data')
  .hook('preAction', (command) => {
    if (command.opts().debug) process.env.CHATBRIDGE_DEBUG = '1';
  });
const browser = program.command('browser').description('Manage the isolated browser');
browser
  .command('open')
  .description('Open the managed browser for manual login')
  .action(async () => {
    console.log(await openManagedBrowser(loadConfig()));
    console.log('If needed, log in to ChatGPT manually in the opened browser.');
  });
browser.command('doctor').description('Check local browser prerequisites').action(doctor);
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
