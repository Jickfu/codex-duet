import type { TestStatus } from '../core/domain.js';

export type GitHubContextRef = {
  mode: 'GITHUB';
  repository: string;
  remote: string;
  taskId: string;
  taskBranch: string;
  baseRef: string;
};

export type LocalContextRef = {
  mode: 'LOCAL';
  taskId: string;
};

export type ContextRef = GitHubContextRef | LocalContextRef;

export type GitHubReviewTarget = GitHubContextRef & {
  reviewRef: string;
  testStatus: TestStatus;
};

export type LocalReviewTarget = LocalContextRef;

export type ReviewTarget = GitHubReviewTarget | LocalReviewTarget;

export interface CodeProvider {
  prepareContext(taskId: string): Promise<ContextRef>;
  getReviewTarget(taskId: string, testStatus: TestStatus): Promise<ReviewTarget>;
}
