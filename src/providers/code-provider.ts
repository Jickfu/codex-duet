export type TestStatus = 'PASS' | 'FAIL' | 'NOT_RUN';

export type ContextRef = {
  mode: 'GITHUB';
  repository: string;
  remote: string;
  taskId: string;
  taskBranch: string;
  baseRef: string;
};

export type ReviewTarget = ContextRef & {
  reviewRef: string;
  testStatus: TestStatus;
};

export interface CodeProvider {
  prepareContext(taskId: string): Promise<ContextRef>;
  getReviewTarget(taskId: string, testStatus: TestStatus): Promise<ReviewTarget>;
}
