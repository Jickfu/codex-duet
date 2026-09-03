import { access, readFile } from 'node:fs/promises';
import { registerLocalLifecycleCommands } from './local-lifecycle.js';
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
  LocalTaskSpecStore,
  assertLocalContracts,
  validateLocalTaskSpec,
} from '../local/task-spec.js';
import { localControlEnvelope } from '../local/control-projection.js';
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

/** Additive LOCAL data-plane and guarded lifecycle commands. */
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
  registerLocalLifecycleCommands(local, cwd, report);
  local
    .command('bind-task-spec')
    .description('Bind immutable LOCAL semantics before execution; no message send')
    .requiredOption('--task <id>')
    .requiredOption('--request-file <path>')
    .requiredOption('--task-spec-file <path>')
    .action(async (o: { task: string; requestFile: string; taskSpecFile: string }) => {
      const [request, candidate] = await Promise.all([
        readFile(path.resolve(cwd(), o.requestFile), 'utf8'),
        readFile(path.resolve(cwd(), o.taskSpecFile), 'utf8'),
      ]);
      await run(o.task, async ({ taskId, provider, snapshots }) => {
        const state = await provider.status(taskId);
        if (state.reviews.length !== 0)
          throw new ChatbridgeError(
            'TaskSpec must be bound before reviews',
            'LOCAL_SPEC_BINDING_TOO_LATE',
          );
        const spec = validateLocalTaskSpec(JSON.parse(candidate), state.context, request);
        // Fail compact-envelope and contract checks before publishing durable semantics.
        localControlEnvelope(spec);
        await assertLocalContracts(spec, snapshots.store);
        await snapshots.assertLiveSnapshot(state.context.baselineSnapshotId);
        await new LocalTaskSpecStore(path.join(cwd(), '.chatbridge')).createOrVerify(
          spec,
          state.context,
        );
        return { taskId, taskSpecSha256: spec.integrity.sha256, bound: true };
      });
    });
  local
    .command('project-control')
    .description('Produce LOCAL C2C without sending or accepting lifecycle transitions')
    .requiredOption('--task <id>')
    .option('--review', 'project the current already-prepared review')
    .action((o: { task: string; review?: boolean }) =>
      run(o.task, async ({ taskId, provider, snapshots }) => {
        let lifecycleExists = true;
        try {
          await access(path.join(cwd(), '.chatbridge', 'runs', taskId, 'local', 'run.json'));
        } catch (error: any) {
          if (error?.code !== 'ENOENT') throw error;
          lifecycleExists = false;
        }
        if (lifecycleExists)
          throw new ChatbridgeError(
            'Use the durable run control from run-status',
            'LOCAL_CONTROL_LIFECYCLE_OWNED',
          );
        const state = await provider.status(taskId);
        const spec = await new LocalTaskSpecStore(path.join(cwd(), '.chatbridge')).read(
          state.context,
        );
        await assertLocalContracts(spec, snapshots.store);
        if (o.review) {
          if (!state.reviews.length)
            throw new ChatbridgeError('No prepared review', 'LOCAL_REVIEW_REQUIRED');
          const target = await provider.prepareReview({ taskId, iteration: state.reviews.length });
          return { envelope: localControlEnvelope(spec, target) };
        }
        if (state.reviews.length)
          throw new ChatbridgeError('Initial planning is closed', 'LOCAL_PLANNING_CLOSED');
        await snapshots.assertLiveSnapshot(state.context.baselineSnapshotId);
        return { envelope: localControlEnvelope(spec) };
      }),
    );
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
