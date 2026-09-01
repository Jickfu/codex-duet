import type { GitHubReviewTarget } from '../providers/code-provider.js';
import { serializeEnvelope } from '../core/protocol.js';

export function githubReviewEnvelope(target: GitHubReviewTarget, iteration = 1): string {
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
      'Review the implementation using the GitHub data plane.\n' +
      'Review exactly BASE_REF..REVIEW_REF.\n' +
      'Do not review a moving branch head.',
  });
}
