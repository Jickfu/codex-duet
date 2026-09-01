import path from 'node:path';
import process from 'node:process';
import { GitRunner } from '../github/git-runner.js';
import { GitHubCodeProvider } from '../github/github-code-provider.js';
import { githubReviewEnvelope } from '../github/review-envelope.js';
import type { TestStatus } from '../core/domain.js';

function provider(): GitHubCodeProvider {
  const cwd = process.cwd();
  return new GitHubCodeProvider(new GitRunner(cwd), 'origin', path.join(cwd, '.chatbridge'));
}

export async function githubDoctor(task?: string): Promise<void> {
  console.log(JSON.stringify(await provider().doctor(task), null, 2));
}

export async function githubInitTask(task: string): Promise<void> {
  console.log(JSON.stringify(await provider().prepareContext(task), null, 2));
}

export async function githubStatus(task: string): Promise<void> {
  console.log(JSON.stringify(await provider().status(task), null, 2));
}

export async function githubPrepareReview(task: string, tests: TestStatus): Promise<void> {
  const target = await provider().getReviewTarget(task, tests);
  console.log(githubReviewEnvelope(target));
}
