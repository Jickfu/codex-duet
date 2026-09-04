import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import { z } from 'zod';
import { TaskIdSchema } from '../core/domain.js';
import { ChatbridgeError } from '../core/errors.js';
import { sha256 } from '../duet/task-spec.js';
import { TaskInteractionPolicyStore } from '../duet/interaction-policy-store.js';
import { GitLocalSnapshotAuthority } from '../local/git-snapshot-authority.js';
import { LocalEvidenceStore } from '../local/evidence-store.js';
import { LocalCodeProvider } from '../local/local-code-provider.js';
import { LocalLifecycle } from '../local/lifecycle.js';
import { StoredLocalLifecycleGates } from '../local/lifecycle-gates.js';
import { LocalTaskSpecStore } from '../local/task-spec.js';
import { LocalDiscussion } from '../local/discussion.js';

export function registerLocalLifecycleCommands(
  local: Command,
  cwd: () => string,
  report: (value: unknown) => void,
) {
  async function runtime(task: string, supplement = false) {
    const taskId = TaskIdSchema.parse(task);
    const root = cwd();
    const snapshots = await GitLocalSnapshotAuthority.open(root, taskId);
    const stateRoot = path.join(root, '.chatbridge');
    const provider = new LocalCodeProvider(snapshots, new LocalEvidenceStore(stateRoot), stateRoot);
    // Lifecycle methods already own the task lock; do not wrap them in the data-plane CLI lock.
    return {
      taskId,
      stateRoot,
      provider,
      discussion: new LocalDiscussion(
        stateRoot,
        provider,
        snapshots,
        supplement ? 'supplement' : 'primary',
      ),
      lifecycle: new LocalLifecycle(
        stateRoot,
        provider,
        snapshots,
        new StoredLocalLifecycleGates(stateRoot),
      ),
    };
  }
  local
    .command('discussion-prepare')
    .description('Prepare or recover one explicit LOCAL Discussion round; never sends')
    .requiredOption('--task <id>')
    .requiredOption('--round <n>')
    .requiredOption('--request-file <path>')
    .option('--supplement', 'use the one user-authorized supplemental segment')
    .action(
      async (o: { task: string; round: string; requestFile: string; supplement?: boolean }) => {
        const round = z.coerce.number().int().min(1).max(3).parse(o.round);
        const question = await readFile(path.resolve(cwd(), o.requestFile), 'utf8');
        const { taskId, stateRoot, discussion } = await runtime(o.task, o.supplement);
        const control = await discussion.prepare(taskId, round, question);
        report({
          control,
          controlFile: path.join(
            stateRoot,
            'runs',
            taskId,
            'discussion',
            o.supplement ? 'local-supplement' : '',
            `round-${round}`,
            'request.json',
          ),
        });
      },
    );
  local
    .command('discussion-ingest')
    .requiredOption('--task <id>')
    .requiredOption('--message-file <path>')
    .option('--supplement', 'ingest into the authorized supplemental segment')
    .action(async (o: { task: string; messageFile: string; supplement?: boolean }) => {
      const response = await readFile(path.resolve(cwd(), o.messageFile), 'utf8');
      const { taskId, discussion } = await runtime(o.task, o.supplement);
      report(await discussion.ingest(taskId, response));
    });
  for (const [name, method] of [
    ['discussion-status', 'status'],
    ['discussion-recover', 'recover'],
  ] as const) {
    local
      .command(name)
      .requiredOption('--task <id>')
      .option('--supplement', 'read/recover the supplemental segment')
      .action(async (o: { task: string; supplement?: boolean }) => {
        const { taskId, discussion } = await runtime(o.task, o.supplement);
        report(await discussion[method](taskId));
      });
  }
  local
    .command('discussion-resume')
    .description(
      'Record one explicit in-scope user decision and prepare supplemental round one; never sends',
    )
    .requiredOption('--task <id>')
    .requiredOption('--blocked-control-sha256 <sha256>')
    .requiredOption('--decision-file <path>')
    .requiredOption('--scope-unchanged')
    .action(
      async (o: {
        task: string;
        blockedControlSha256: string;
        decisionFile: string;
        scopeUnchanged: true;
      }) => {
        const { taskId, stateRoot, discussion } = await runtime(o.task);
        const decision = await readFile(path.resolve(cwd(), o.decisionFile), 'utf8');
        const control = await discussion.resume(taskId, {
          blockedControlSha256: o.blockedControlSha256,
          decision,
          scopeUnchanged: o.scopeUnchanged,
        });
        report({
          control,
          controlFile: path.join(
            stateRoot,
            'runs',
            taskId,
            'discussion',
            'local-supplement',
            'round-1',
            'request.json',
          ),
        });
      },
    );
  local
    .command('run-init')
    .description('Initialize guarded LOCAL lifecycle from bound spec and stored interaction policy')
    .requiredOption('--task <id>')
    .option('--max-iterations <n>', 'maximum review rounds', '5')
    .action(async (o: { task: string; maxIterations: string }) => {
      const maximum = z.coerce.number().int().min(1).max(100).parse(o.maxIterations);
      const { taskId, stateRoot, provider, lifecycle } = await runtime(o.task);
      const context = (await provider.status(taskId)).context;
      const spec = await new LocalTaskSpecStore(stateRoot).read(context);
      const policy = await new TaskInteractionPolicyStore(stateRoot).read(taskId);
      if (!policy)
        throw new ChatbridgeError(
          'Explicit interaction policy required',
          'INTERACTION_POLICY_REQUIRED',
        );
      report(await lifecycle.init(spec, policy, maximum));
    });
  for (const [name, method] of [
    ['run-status', 'status'],
    ['confirm-control', 'confirmControl'],
    ['begin-execution', 'beginExecution'],
    ['reconcile-execution', 'reconcileExecution'],
    ['run-prepare-review', 'prepareReview'],
  ] as const) {
    local
      .command(name)
      .requiredOption('--task <id>')
      .action(async (o: { task: string }) => {
        const { taskId, lifecycle } = await runtime(o.task);
        report(await lifecycle[method](taskId));
      });
  }
  local
    .command('run-cancel')
    .description('Cancel LOCAL lifecycle with a durable reason; no rollback or transport action')
    .requiredOption('--task <id>')
    .requiredOption('--reason <text>')
    .action(async (o: { task: string; reason: string }) => {
      const { taskId, lifecycle } = await runtime(o.task);
      report(await lifecycle.cancel(taskId, o.reason));
    });
  local
    .command('resume-blocked')
    .description(
      'Append an explicit in-scope user decision and prepare a new Planner control; never sends',
    )
    .requiredOption('--task <id>')
    .requiredOption('--blocked-control-sha256 <sha256>')
    .requiredOption('--decision-file <path>')
    .requiredOption(
      '--scope-unchanged',
      'assert that the user decision does not alter TaskSpec scope or requirements',
    )
    .action(
      async (o: {
        task: string;
        blockedControlSha256: string;
        decisionFile: string;
        scopeUnchanged: true;
      }) => {
        const decision = await readFile(path.resolve(cwd(), o.decisionFile), 'utf8');
        const { taskId, lifecycle } = await runtime(o.task);
        report(
          await lifecycle.resumeBlocked(taskId, {
            blockedControlSha256: o.blockedControlSha256,
            decision,
            scopeUnchanged: o.scopeUnchanged,
          }),
        );
      },
    );
  local
    .command('ingest-response')
    .description('Accept exact recorded Browser response through guarded shared ingress')
    .requiredOption('--task <id>')
    .requiredOption('--message-file <path>')
    .action(async (o: { task: string; messageFile: string }) => {
      const { taskId, lifecycle } = await runtime(o.task);
      const response = await readFile(path.resolve(cwd(), o.messageFile), 'utf8');
      const run = await lifecycle.status(taskId);
      const replay = run.responses.find((record) => record.responseSha256 === sha256(response));
      report(
        await lifecycle.ingest({
          taskId,
          source: 'BROWSER',
          response,
          iteration: replay?.iteration ?? run.iteration,
          controlSha256: replay?.controlSha256 ?? sha256(run.control),
        }),
      );
    });
}
