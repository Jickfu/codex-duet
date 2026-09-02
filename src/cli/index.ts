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
  duetRecordTests,
  duetReconcileExecution,
  duetStatus,
  duetInteractionInit,
  duetCodexBrowserPrepare,
  duetCodexBrowserComplete,
  duetCodexBrowserMarkAttempted,
  duetCodexBrowserReceive,
  duetDiscussionPrepare,
  duetDiscussionIngest,
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
  .requiredOption('--interaction-policy-file <path>')
  .option('--task-spec-file <path>', 'normalized TaskSpecV1 for compact C2C')
  .requiredOption('--output <path>')
  .option('--max-iterations <n>', 'maximum review/fix iterations', Number)
  .action(
    (o: {
      task: string;
      requestFile: string;
      interactionPolicyFile: string;
      taskSpecFile?: string;
      output: string;
      maxIterations?: number;
    }) =>
      duetInit(
        o.task,
        o.requestFile,
        o.output,
        o.interactionPolicyFile,
        o.maxIterations,
        o.taskSpecFile,
      ),
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
  .command('record-tests')
  .requiredOption('--task <id>')
  .addOption(
    new Option('--status <status>').choices(['PASS', 'FAIL', 'NOT_RUN']).makeOptionMandatory(),
  )
  .action((o: { task: string; status: 'PASS' | 'FAIL' | 'NOT_RUN' }) =>
    duetRecordTests(o.task, o.status),
  );
duet
  .command('reconcile-execution')
  .requiredOption('--task <id>')
  .action((o: { task: string }) => duetReconcileExecution(o.task));
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
duet
  .command('interaction-init')
  .requiredOption('--task <id>')
  .requiredOption('--policy-file <path>')
  .action((o: { task: string; policyFile: string }) => duetInteractionInit(o.task, o.policyFile));
duet
  .command('codex-browser-prepare')
  .requiredOption('--task <id>')
  .requiredOption('--message-file <path>')
  .addOption(
    new Option('--kind <kind>')
      .choices(['DISCUSSION', 'PLANNER', 'REVIEWER'])
      .makeOptionMandatory(),
  )
  .requiredOption('--iteration <n>', 'lifecycle iteration', Number)
  .option('--round <n>', 'discussion round', Number)
  .option('--conversation-url <url>', 'exact known ChatGPT conversation')
  .action(
    (o: {
      task: string;
      messageFile: string;
      kind: 'DISCUSSION' | 'PLANNER' | 'REVIEWER';
      iteration: number;
      round?: number;
      conversationUrl?: string;
    }) =>
      duetCodexBrowserPrepare(
        o.task,
        o.messageFile,
        o.kind,
        o.iteration,
        o.round,
        o.conversationUrl,
      ),
  );
duet
  .command('codex-browser-mark-attempted')
  .requiredOption('--task <id>')
  .action((o: { task: string }) => duetCodexBrowserMarkAttempted(o.task));
duet
  .command('codex-browser-complete')
  .requiredOption('--task <id>')
  .addOption(
    new Option('--outcome <outcome>')
      .choices(['CONFIRMED', 'OUTCOME_UNKNOWN'])
      .makeOptionMandatory(),
  )
  .option('--conversation-url <url>')
  .action(
    (o: { task: string; outcome: 'CONFIRMED' | 'OUTCOME_UNKNOWN'; conversationUrl?: string }) =>
      duetCodexBrowserComplete(o.task, o.outcome, o.conversationUrl),
  );
duet
  .command('codex-browser-receive')
  .requiredOption('--task <id>')
  .requiredOption('--response-file <path>')
  .requiredOption('--conversation-url <url>')
  .action((o: { task: string; responseFile: string; conversationUrl: string }) =>
    duetCodexBrowserReceive(o.task, o.responseFile, o.conversationUrl),
  );
duet
  .command('discussion-prepare')
  .requiredOption('--task <id>')
  .requiredOption('--request-file <path>')
  .requiredOption('--output <path>')
  .action((o: { task: string; requestFile: string; output: string }) =>
    duetDiscussionPrepare(o.task, o.requestFile, o.output),
  );
duet
  .command('discussion-ingest')
  .requiredOption('--task <id>')
  .requiredOption('--message-file <path>')
  .action((o: { task: string; messageFile: string }) =>
    duetDiscussionIngest(o.task, o.messageFile),
  );
program
  .command('send')
  .requiredOption('--message-file <path>')
  .option('--task <id>', 'use task-scoped Browser binding')
  .option('--conversation-url <url>', 'explicit conversation bootstrap target')
  .action((o: { messageFile: string; task?: string; conversationUrl?: string }) => {
    if (o.conversationUrl && !o.task)
      throw new ChatbridgeError('--conversation-url requires --task', 'TASK_REQUIRED');
    return send(o.messageFile, o.task, o.conversationUrl);
  });
program
  .command('wait')
  .option('--parse', 'parse and validate C2C/1')
  .option('--timeout <ms>', 'timeout in milliseconds', Number)
  .option('--task <id>', 'use task-scoped Browser binding')
  .action((o: { parse?: boolean; timeout?: number; task?: string }) =>
    wait(Boolean(o.parse), o.timeout, o.task),
  );
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
