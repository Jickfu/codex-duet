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

export function registerLocalLifecycleCommands(
  local: Command,
  cwd: () => string,
  report: (value: unknown) => void,
) {
  async function runtime(task: string) {
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
      lifecycle: new LocalLifecycle(
        stateRoot,
        provider,
        snapshots,
        new StoredLocalLifecycleGates(stateRoot),
      ),
    };
  }
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
