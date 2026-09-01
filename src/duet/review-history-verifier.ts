import type { GitRunner } from '../github/git-runner.js';

export interface ReviewHistoryVerifier {
  isAncestor(previousReviewRef: string, currentReviewRef: string): Promise<boolean>;
}

export class GitReviewHistoryVerifier implements ReviewHistoryVerifier {
  constructor(private readonly git: Pick<GitRunner, 'run'>) {}

  async isAncestor(previousReviewRef: string, currentReviewRef: string): Promise<boolean> {
    try {
      await this.git.run(['merge-base', '--is-ancestor', previousReviewRef, currentReviewRef]);
      return true;
    } catch {
      return false;
    }
  }
}
