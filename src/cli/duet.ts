import path from 'node:path';
import process from 'node:process';
import type { TestStatus } from '../core/domain.js';
import { GitRunner } from '../github/git-runner.js';
import { GitHubCodeProvider } from '../github/github-code-provider.js';
import { DuetOrchestrator } from '../duet/orchestrator.js';
import { DuetRunStore } from '../duet/run-store.js';
import { GitReviewHistoryVerifier } from '../duet/review-history-verifier.js';
import { ExecutionStore } from '../duet/execution-store.js';
import { GitExecutionWorkspaceInspector } from '../duet/execution-workspace-inspector.js';
import { TaskOperationLock } from '../duet/task-operation-lock.js';
import { TaskSpecStore } from '../duet/task-spec-store.js';
import { TaskContextStore } from '../duet/task-context-store.js';

function orchestrator(): DuetOrchestrator {
  const cwd = process.cwd();
  const stateRoot = path.join(cwd, '.chatbridge');
  const git = new GitRunner(cwd);
  return new DuetOrchestrator(
    new GitHubCodeProvider(git, 'origin', stateRoot),
    new DuetRunStore(stateRoot),
    new GitReviewHistoryVerifier(git),
    {
      store: new ExecutionStore(stateRoot),
      inspector: new GitExecutionWorkspaceInspector(git),
      lock: new TaskOperationLock(stateRoot),
    },
    new TaskSpecStore(stateRoot),
    new TaskContextStore(stateRoot),
  );
}

export async function duetInit(
  task: string,
  requestFile: string,
  output: string,
  maxIterations?: number,
  taskSpecFile?: string,
): Promise<void> {
  console.log(
    JSON.stringify(
      await orchestrator().init(task, requestFile, output, maxIterations ?? 8, taskSpecFile),
      null,
      2,
    ),
  );
}

export async function duetIngest(task: string, messageFile: string): Promise<void> {
  console.log(JSON.stringify(await orchestrator().ingest(task, messageFile), null, 2));
}

export async function duetBeginExecution(task: string): Promise<void> {
  console.log(JSON.stringify(await orchestrator().beginExecution(task), null, 2));
}

export async function duetPrepareReview(
  task: string,
  tests: TestStatus,
  output: string,
): Promise<void> {
  console.log(JSON.stringify(await orchestrator().prepareReview(task, tests, output), null, 2));
}

export async function duetRecordTests(task: string, status: TestStatus): Promise<void> {
  console.log(JSON.stringify(await orchestrator().recordTests(task, status), null, 2));
}

export async function duetReconcileExecution(task: string): Promise<void> {
  console.log(JSON.stringify(await orchestrator().reconcileExecution(task), null, 2));
}

export async function duetMarkReviewing(task: string): Promise<void> {
  console.log(JSON.stringify(await orchestrator().markReviewing(task), null, 2));
}

export async function duetStatus(task: string): Promise<void> {
  console.log(JSON.stringify(await orchestrator().status(task), null, 2));
}
