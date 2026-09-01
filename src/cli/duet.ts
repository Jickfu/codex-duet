import path from 'node:path';
import process from 'node:process';
import type { TestStatus } from '../core/domain.js';
import { GitRunner } from '../github/git-runner.js';
import { GitHubCodeProvider } from '../github/github-code-provider.js';
import { DuetOrchestrator } from '../duet/orchestrator.js';
import { DuetRunStore } from '../duet/run-store.js';
import { GitReviewHistoryVerifier } from '../duet/review-history-verifier.js';

function orchestrator(): DuetOrchestrator {
  const cwd = process.cwd();
  const stateRoot = path.join(cwd, '.chatbridge');
  const git = new GitRunner(cwd);
  return new DuetOrchestrator(
    new GitHubCodeProvider(git, 'origin', stateRoot),
    new DuetRunStore(stateRoot),
    new GitReviewHistoryVerifier(git),
  );
}

export async function duetInit(
  task: string,
  requestFile: string,
  output: string,
  maxIterations?: number,
): Promise<void> {
  console.log(
    JSON.stringify(
      await orchestrator().init(task, requestFile, output, maxIterations ?? 8),
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

export async function duetMarkReviewing(task: string): Promise<void> {
  console.log(JSON.stringify(await orchestrator().markReviewing(task), null, 2));
}

export async function duetStatus(task: string): Promise<void> {
  console.log(JSON.stringify(await orchestrator().status(task), null, 2));
}
