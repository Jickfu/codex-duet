import path from 'node:path';
import { ChatbridgeError } from '../core/errors.js';
import { TaskCheckpointStore } from '../core/checkpoint.js';
import type { GitHubTaskCheckpoint, TaskCheckpoint } from '../core/task.js';
import type { TestStatus } from '../core/domain.js';
import { TaskIdSchema } from '../core/domain.js';
import type {
  CodeProvider,
  GitHubContextRef,
  GitHubReviewTarget,
} from '../providers/code-provider.js';
import { FullShaSchema, parseGitHubRemote, taskBranchFor } from './domain.js';
import { GitRunner } from './git-runner.js';

export type GitHubDoctorReport = {
  gitInstalled: true;
  repositoryDetected: true;
  repository: string;
  remote: string;
  remoteUrl: string;
  currentBranch: string;
  head: string;
  clean: boolean;
  task?: TaskCheckpoint;
};

export class GitHubCodeProvider implements CodeProvider {
  private readonly store: TaskCheckpointStore;

  constructor(
    private readonly git: GitRunner,
    private readonly remote = 'origin',
    stateRoot = path.join(git.cwd, '.chatbridge'),
  ) {
    if (!/^[A-Za-z0-9._-]+$/.test(remote))
      throw new ChatbridgeError('Invalid remote name', 'INVALID_GIT_REMOTE');
    this.store = new TaskCheckpointStore(stateRoot);
  }

  async doctor(taskId?: string): Promise<GitHubDoctorReport> {
    await this.git.run(['--version']);
    await this.requireRepository();
    const remoteUrl = await this.remoteUrl();
    const repository = this.repositoryFrom(remoteUrl);
    const [currentBranch, head, status] = await Promise.all([
      this.currentBranch(),
      this.head(),
      this.git.run(['status', '--porcelain=v1', '-uall']),
    ]);
    const task = taskId ? await this.store.read(this.taskId(taskId)) : undefined;
    return {
      gitInstalled: true,
      repositoryDetected: true,
      repository,
      remote: this.remote,
      remoteUrl: redactRemoteUrl(remoteUrl),
      currentBranch,
      head,
      clean: status.stdout.length === 0,
      ...(task ? { task } : {}),
    };
  }

  async prepareContext(taskIdInput: string): Promise<GitHubContextRef> {
    const taskId = this.taskId(taskIdInput);
    const taskBranch = taskBranchFor(taskId);
    await this.requireClean();
    await this.requireRepository();
    const repository = this.repositoryFrom(await this.remoteUrl());
    const existing = await this.store.read(taskId);
    if (existing) {
      const githubCheckpoint = this.githubCheckpoint(existing);
      this.validateIdentity(githubCheckpoint, repository, taskBranch);
      const branches = await this.git.run(['branch', '--list', taskBranch]);
      if (!branches.stdout)
        throw new ChatbridgeError('Task branch is missing', 'TASK_BRANCH_MISSING');
      return this.context(githubCheckpoint);
    }

    const branches = await this.git.run(['branch', '--list', taskBranch]);
    if (branches.stdout)
      throw new ChatbridgeError(`Task branch already exists: ${taskBranch}`, 'TASK_BRANCH_EXISTS');

    await this.git.run(['fetch', this.remote]);
    const baseRef = await this.head();
    await this.git.run(['checkout', '-b', taskBranch, baseRef]);
    const now = new Date().toISOString();
    const checkpoint: TaskCheckpoint = {
      version: 1,
      taskId,
      mode: 'GITHUB',
      iteration: 0,
      state: 'INIT',
      repository,
      remote: this.remote,
      taskBranch,
      baseRef,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.write(checkpoint);
    return this.context(checkpoint);
  }

  async status(taskIdInput: string): Promise<TaskCheckpoint> {
    const taskId = this.taskId(taskIdInput);
    const checkpoint = await this.store.read(taskId);
    if (!checkpoint) throw new ChatbridgeError(`No task metadata for ${taskId}`, 'TASK_NOT_FOUND');
    return checkpoint;
  }

  async getReviewTarget(taskIdInput: string, testStatus: TestStatus): Promise<GitHubReviewTarget> {
    const taskId = this.taskId(taskIdInput);
    await this.requireClean();
    const checkpoint = this.githubCheckpoint(await this.status(taskId));
    const repository = this.repositoryFrom(await this.remoteUrl());
    this.validateIdentity(checkpoint, repository, taskBranchFor(taskId));
    if ((await this.currentBranch()) !== checkpoint.taskBranch)
      throw new ChatbridgeError('Current branch is not the task branch', 'TASK_BRANCH_MISMATCH');

    const reviewRef = await this.head();
    if (reviewRef === checkpoint.baseRef)
      throw new ChatbridgeError('Task has no commit after BASE_REF', 'TASK_COMMIT_MISSING');
    try {
      await this.git.run(['merge-base', '--is-ancestor', checkpoint.baseRef, reviewRef]);
    } catch {
      throw new ChatbridgeError(
        'BASE_REF is not an ancestor of REVIEW_REF',
        'TASK_HISTORY_DIVERGED',
      );
    }

    try {
      await this.git.run([
        'push',
        checkpoint.remote,
        `${checkpoint.taskBranch}:${checkpoint.taskBranch}`,
      ]);
    } catch (error) {
      if (error instanceof Error && /non-fast-forward|rejected/i.test(error.message))
        throw new ChatbridgeError('Task branch push was non-fast-forward', 'PUSH_NON_FAST_FORWARD');
      throw error;
    }
    const remoteResult = await this.git.run([
      'ls-remote',
      '--heads',
      checkpoint.remote,
      `refs/heads/${checkpoint.taskBranch}`,
    ]);
    const remoteSha = remoteResult.stdout.split(/\s+/)[0];
    if (!remoteSha || !FullShaSchema.safeParse(remoteSha).success || remoteSha !== reviewRef)
      throw new ChatbridgeError(
        'Remote task branch does not match local HEAD',
        'REMOTE_SHA_MISMATCH',
      );

    const updated: TaskCheckpoint = {
      ...checkpoint,
      state: 'EXECUTED',
      reviewRef,
      testStatus,
      updatedAt: new Date().toISOString(),
    };
    await this.store.write(updated);
    return { ...this.context(updated), reviewRef, testStatus };
  }

  private async requireRepository(): Promise<void> {
    try {
      const result = await this.git.run(['rev-parse', '--is-inside-work-tree']);
      if (result.stdout !== 'true') throw new Error('not a work tree');
    } catch {
      throw new ChatbridgeError('Current directory is not a Git repository', 'NOT_GIT_REPOSITORY');
    }
  }

  private async requireClean(): Promise<void> {
    await this.requireRepository();
    const status = await this.git.run(['status', '--porcelain=v1', '-uall']);
    if (status.stdout) throw new ChatbridgeError('Working tree must be clean', 'WORKTREE_DIRTY');
  }

  private async remoteUrl(): Promise<string> {
    try {
      return (await this.git.run(['config', '--get', `remote.${this.remote}.url`])).stdout;
    } catch {
      throw new ChatbridgeError(
        `Configured remote does not exist: ${this.remote}`,
        'GIT_REMOTE_MISSING',
      );
    }
  }

  private repositoryFrom(remoteUrl: string): string {
    try {
      return parseGitHubRemote(remoteUrl);
    } catch {
      throw new ChatbridgeError('Only GitHub remotes are supported', 'UNSUPPORTED_GIT_REMOTE');
    }
  }

  private async head(): Promise<string> {
    const value = (await this.git.run(['rev-parse', '--verify', 'HEAD'])).stdout;
    const parsed = FullShaSchema.safeParse(value);
    if (!parsed.success)
      throw new ChatbridgeError('HEAD is not a full commit SHA', 'INVALID_GIT_SHA');
    return parsed.data;
  }

  private async currentBranch(): Promise<string> {
    const branch = (await this.git.run(['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout;
    if (!branch) throw new ChatbridgeError('Detached HEAD is unsupported', 'DETACHED_HEAD');
    return branch;
  }

  private validateIdentity(
    checkpoint: GitHubTaskCheckpoint,
    repository: string,
    branch: string,
  ): void {
    if (
      checkpoint.repository !== repository ||
      checkpoint.remote !== this.remote ||
      checkpoint.taskBranch !== branch
    )
      throw new ChatbridgeError(
        'Task metadata does not match this repository',
        'TASK_METADATA_MISMATCH',
      );
  }

  private context(checkpoint: GitHubTaskCheckpoint): GitHubContextRef {
    return {
      mode: 'GITHUB',
      repository: checkpoint.repository,
      remote: checkpoint.remote,
      taskId: checkpoint.taskId,
      taskBranch: checkpoint.taskBranch,
      baseRef: checkpoint.baseRef,
    };
  }

  private taskId(input: string): string {
    const parsed = TaskIdSchema.safeParse(input);
    if (!parsed.success) throw new ChatbridgeError('Invalid task ID', 'INVALID_TASK_ID');
    return parsed.data;
  }

  private githubCheckpoint(checkpoint: TaskCheckpoint): GitHubTaskCheckpoint {
    if (checkpoint.mode !== 'GITHUB')
      throw new ChatbridgeError('Task is not in GitHub mode', 'TASK_MODE_MISMATCH');
    return checkpoint;
  }
}

function redactRemoteUrl(value: string): string {
  return value.replace(/^(https?:\/\/)[^/@\s]+@/i, '$1[redacted]@');
}
