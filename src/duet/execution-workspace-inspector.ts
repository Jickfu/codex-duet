import { ChatbridgeError } from '../core/errors.js';
import { FullShaSchema } from '../core/github-fields.js';
import type { GitRunner } from '../github/git-runner.js';

export type ExecutionWorkspaceState = {
  branch: string;
  head: string;
  clean: boolean;
  conflicted: boolean;
};

export interface ExecutionWorkspaceInspector {
  inspect(): Promise<ExecutionWorkspaceState>;
  isAncestor(ancestor: string, descendant: string): Promise<boolean>;
}

export class GitExecutionWorkspaceInspector implements ExecutionWorkspaceInspector {
  constructor(private readonly git: Pick<GitRunner, 'run'>) {}

  async inspect(): Promise<ExecutionWorkspaceState> {
    let branch: string;
    try {
      branch = (await this.git.run(['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout;
    } catch {
      throw new ChatbridgeError('Detached HEAD is unsupported', 'EXECUTION_BRANCH_MISMATCH');
    }
    if (!branch)
      throw new ChatbridgeError('Detached HEAD is unsupported', 'EXECUTION_BRANCH_MISMATCH');
    const head = (await this.git.run(['rev-parse', '--verify', 'HEAD'])).stdout;
    if (!FullShaSchema.safeParse(head).success)
      throw new ChatbridgeError('HEAD is not a full commit SHA', 'EXECUTION_HISTORY_DIVERGED');
    const [status, conflicts] = await Promise.all([
      this.git.run(['status', '--porcelain=v1', '-uall']),
      this.git.run(['diff', '--name-only', '--diff-filter=U']),
    ]);
    return {
      branch,
      head,
      clean: status.stdout.length === 0,
      conflicted: conflicts.stdout.length > 0,
    };
  }

  async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    try {
      await this.git.run(['merge-base', '--is-ancestor', ancestor, descendant]);
      return true;
    } catch {
      return false;
    }
  }
}
