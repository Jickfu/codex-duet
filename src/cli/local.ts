import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import { z } from 'zod';
import { ChatbridgeError } from '../core/errors.js';
import { TaskIdSchema } from '../core/domain.js';
import { TaskOperationLock } from '../duet/task-operation-lock.js';
import { GitLocalSnapshotAuthority } from '../local/git-snapshot-authority.js';
import { LocalCodeProvider } from '../local/local-code-provider.js';
import { LocalEvidenceStore } from '../local/evidence-store.js';
import {
  LocalExecutionSummaryV1Schema,
  LocalTestEvidenceV1Schema,
} from '../local/workspace-service.js';

const EvidenceInputSchema = z
  .object({
    tests: LocalTestEvidenceV1Schema,
    execution: LocalExecutionSummaryV1Schema,
  })
  .strict();
const IterationSchema = z.coerce.number().int().positive().safe();

/** Additive data-plane commands; they do not authorize execution or accept reviewer responses. */
export function registerLocalCommands(
  program: Command,
  cwd: () => string = () => process.cwd(),
  report: (value: unknown) => void = (value) => console.log(JSON.stringify(value, null, 2)),
): void {
  async function run(
    taskInput: string,
    operation: (runtime: {
      taskId: string;
      snapshots: GitLocalSnapshotAuthority;
      provider: LocalCodeProvider;
      evidence: LocalEvidenceStore;
    }) => Promise<unknown>,
  ) {
    const taskId = TaskIdSchema.parse(taskInput);
    const root = cwd();
    // Validate the canonical state root before acquiring a filesystem lock beneath it.
    const snapshots = await GitLocalSnapshotAuthority.open(root, taskId);
    const stateRoot = path.join(root, '.chatbridge');
    const evidence = new LocalEvidenceStore(stateRoot);
    const provider = new LocalCodeProvider(snapshots, evidence, stateRoot);
    const value = await new TaskOperationLock(stateRoot).withLock(taskId, () =>
      operation({ taskId, snapshots, provider, evidence }),
    );
    report(value);
  }

  const local = program
    .command('local')
    .description('LOCAL snapshot data plane (no commit, push or test execution)');
  local
    .command('init-task')
    .requiredOption('--task <id>')
    .action((o: { task: string }) =>
      run(o.task, ({ taskId, provider }) => provider.prepareContext(taskId)),
    );
  local
    .command('status')
    .requiredOption('--task <id>')
    .action((o: { task: string }) =>
      run(o.task, ({ taskId, provider }) => provider.status(taskId)),
    );
  local
    .command('assert-ready')
    .description('Check baseline/previous review drift; not execution authorization')
    .requiredOption('--task <id>')
    .action((o: { task: string }) =>
      run(o.task, async ({ taskId, provider }) => {
        await provider.assertReadyForIteration(taskId);
        return { taskId, unchanged: true };
      }),
    );
  local
    .command('capture')
    .description('Capture candidate bytes before the caller runs tests')
    .requiredOption('--task <id>')
    .action((o: { task: string }) =>
      run(o.task, async ({ taskId, provider, snapshots }) => {
        await provider.status(taskId);
        return snapshots.capture(taskId);
      }),
    );
  local
    .command('record-evidence')
    .description('Record caller-supplied tests and execution JSON against an unchanged snapshot')
    .requiredOption('--task <id>')
    .requiredOption('--evidence-file <path>')
    .action(async (o: { task: string; evidenceFile: string }) => {
      const taskId = TaskIdSchema.parse(o.task);
      const input = EvidenceInputSchema.parse(
        JSON.parse(await readFile(path.resolve(cwd(), o.evidenceFile), 'utf8')),
      );
      if (input.tests.taskId !== taskId || input.execution.taskId !== taskId)
        throw new ChatbridgeError(
          'Evidence does not belong to requested task',
          'LOCAL_EVIDENCE_IDENTITY_MISMATCH',
        );
      await run(taskId, async ({ provider, evidence, snapshots }) => {
        const state = await provider.status(taskId);
        const iteration = input.tests.iteration;
        if (iteration !== state.reviews.length + 1 && iteration !== state.reviews.length)
          throw new ChatbridgeError(
            'Evidence iteration is not current or next',
            'LOCAL_ITERATION_MISMATCH',
          );
        // A prepared target can only replay its original evidence, never gain another snapshot.
        if (
          iteration === state.reviews.length &&
          state.reviews.at(-1)?.reviewSnapshotId !== input.tests.snapshotId
        )
          throw new ChatbridgeError(
            'Prepared review snapshot cannot change',
            'LOCAL_REVIEW_REPLAY_DIVERGED',
          );
        await evidence.record(input.tests, input.execution, snapshots);
        return { taskId, iteration, snapshotId: input.tests.snapshotId, recorded: true };
      });
    });
  local
    .command('prepare-review')
    .description('Prepare or recover an immutable LOCAL target; does not send or approve it')
    .requiredOption('--task <id>')
    .requiredOption('--iteration <n>')
    .action((o: { task: string; iteration: string }) => {
      const iteration = IterationSchema.parse(o.iteration);
      return run(o.task, ({ taskId, provider }) => provider.prepareReview({ taskId, iteration }));
    });
}
