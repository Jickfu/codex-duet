import { serializeEnvelope } from '../core/protocol.js';
import type { GitHubReviewTarget } from '../providers/code-provider.js';

export function iterativeReviewEnvelope(
  target: GitHubReviewTarget,
  iteration: number,
  previousReviewRef: string,
): string {
  const formalRange = `${target.baseRef}..${target.reviewRef}`;
  const deltaRange = `${previousReviewRef}..${target.reviewRef}`;
  return serializeEnvelope({
    version: 1,
    taskId: target.taskId,
    iteration,
    state: 'EXECUTED',
    mode: 'GITHUB',
    repository: target.repository,
    taskBranch: target.taskBranch,
    baseRef: target.baseRef,
    reviewRef: target.reviewRef,
    testStatus: target.testStatus,
    content:
      `Review iteration ${iteration} using the GitHub data plane.\n\n` +
      `Formal cumulative review range: ${formalRange}\n` +
      `Previous reviewed ref: ${previousReviewRef}\n` +
      `First inspect the iteration delta: ${deltaRange}\n` +
      `Then validate the cumulative formal range: ${formalRange}\n\n` +
      'The delta is only a review focus. The formal approval identity remains the cumulative range.\n' +
      'Do not review moving refs.',
  });
}
