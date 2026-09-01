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
import { ChatbridgeError } from '../core/errors.js';
import { githubDoctor, githubInitTask, githubPrepareReview, githubStatus } from './github.js';
import {
  duetBeginExecution,
  duetIngest,
  duetInit,
  duetMarkReviewing,
  duetPrepareReview,
  duetStatus,
} from './duet.js';
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
const github = program.command('github').description('Manage the GitHub code/data plane');
github
  .command('doctor')
  .description('Validate Git and GitHub repository prerequisites without mutation')
  .option('--task <id>', 'include durable task metadata')
  .action((o: { task?: string }) => githubDoctor(o.task));
github
  .command('init-task')
  .description('Create or recover one safe task branch')
  .requiredOption('--task <id>')
  .action((o: { task: string }) => githubInitTask(o.task));
github
  .command('status')
  .description('Read durable GitHub task state')
  .requiredOption('--task <id>')
  .action((o: { task: string }) => githubStatus(o.task));
github
  .command('prepare-review')
  .description('Push and verify the immutable GitHub review target')
  .requiredOption('--task <id>')
  .addOption(
    new Option('--tests <status>').choices(['PASS', 'FAIL', 'NOT_RUN']).makeOptionMandatory(),
  )
  .action((o: { task: string; tests: 'PASS' | 'FAIL' | 'NOT_RUN' }) =>
    githubPrepareReview(o.task, o.tests),
  );
const duet = program.command('duet').description('Run deterministic Codex Duet lifecycle guards');
duet
  .command('init')
  .requiredOption('--task <id>')
  .requiredOption('--request-file <path>')
  .requiredOption('--output <path>')
  .option('--max-iterations <n>', 'maximum review/fix iterations', Number)
  .action((o: { task: string; requestFile: string; output: string; maxIterations?: number }) =>
    duetInit(o.task, o.requestFile, o.output, o.maxIterations),
  );
duet
  .command('ingest')
  .requiredOption('--task <id>')
  .requiredOption('--message-file <path>')
  .action((o: { task: string; messageFile: string }) => duetIngest(o.task, o.messageFile));
duet
  .command('begin-execution')
  .requiredOption('--task <id>')
  .action((o: { task: string }) => duetBeginExecution(o.task));
duet
  .command('prepare-review')
  .requiredOption('--task <id>')
  .addOption(
    new Option('--tests <status>').choices(['PASS', 'FAIL', 'NOT_RUN']).makeOptionMandatory(),
  )
  .requiredOption('--output <path>')
  .action((o: { task: string; tests: 'PASS' | 'FAIL' | 'NOT_RUN'; output: string }) =>
    duetPrepareReview(o.task, o.tests, o.output),
  );
duet
  .command('mark-reviewing')
  .requiredOption('--task <id>')
  .action((o: { task: string }) => duetMarkReviewing(o.task));
duet
  .command('status')
  .requiredOption('--task <id>')
  .action((o: { task: string }) => duetStatus(o.task));
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
  console.error(
    error instanceof ChatbridgeError
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? error.message
        : String(error),
  );
  process.exitCode = 1;
});
