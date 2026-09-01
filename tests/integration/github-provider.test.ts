import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { GitRunner } from '../../src/github/git-runner.js';
import { GitHubCodeProvider } from '../../src/github/github-code-provider.js';
import { githubReviewEnvelope } from '../../src/github/review-envelope.js';

const run = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await run('git', args, { cwd, windowsHide: true })).stdout.trim();
}

async function fixture(): Promise<{
  repo: string;
  bare: string;
  provider: GitHubCodeProvider;
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'codex-duet-github-'));
  const repo = path.join(root, 'repo');
  const bare = path.join(root, 'remote.git');
  await mkdir(repo);
  await git(root, 'init', '--bare', bare);
  await git(repo, 'init', '-b', 'main');
  await git(repo, 'config', 'user.name', 'Test User');
  await git(repo, 'config', 'user.email', 'test@example.com');
  await writeFile(path.join(repo, '.gitignore'), '.chatbridge/\n');
  await writeFile(path.join(repo, 'README.md'), 'base\n');
  await git(repo, 'add', '.');
  await git(repo, 'commit', '-m', 'base');
  await git(repo, 'remote', 'add', 'origin', 'https://github.com/example/project.git');
  await git(
    repo,
    'config',
    `url.${pathToFileURL(bare).href}.insteadOf`,
    'https://github.com/example/project.git',
  );
  await git(repo, 'push', '-u', 'origin', 'main');
  return { repo, bare, provider: new GitHubCodeProvider(new GitRunner(repo)) };
}

describe('GitHubCodeProvider offline integration', { timeout: 15_000 }, () => {
  it('reports a valid repository without mutation', async () => {
    const { provider } = await fixture();
    await expect(provider.doctor()).resolves.toMatchObject({
      gitInstalled: true,
      repositoryDetected: true,
      repository: 'example/project',
      remote: 'origin',
      currentBranch: 'main',
      clean: true,
    });
  });

  it('completes init, commit, verified push, persistence recovery, and envelope', async () => {
    const { repo, bare, provider } = await fixture();
    const context = await provider.prepareContext('demo');
    expect(context.taskBranch).toBe('agent/task-demo');
    expect(context.baseRef).toMatch(/^[0-9a-f]{40}$/);
    expect(await git(repo, 'branch', '--show-current')).toBe('agent/task-demo');

    await writeFile(path.join(repo, 'feature.txt'), 'implemented\n');
    await git(repo, 'add', 'feature.txt');
    await git(repo, 'commit', '-m', 'implement demo');
    const restarted = new GitHubCodeProvider(new GitRunner(repo));
    await expect(restarted.status('demo')).resolves.toMatchObject({ baseRef: context.baseRef });
    const target = await restarted.getReviewTarget('demo', 'PASS');
    expect(target.reviewRef).toMatch(/^[0-9a-f]{40}$/);
    expect(target.reviewRef).not.toBe(target.baseRef);
    expect(await git(bare, 'rev-parse', 'refs/heads/agent/task-demo')).toBe(target.reviewRef);
    expect(githubReviewEnvelope(target)).toContain(`BASE_REF: ${target.baseRef}`);
    expect(githubReviewEnvelope(target)).toContain(`REVIEW_REF: ${target.reviewRef}`);
    expect(githubReviewEnvelope(target)).not.toContain('diff --git');
  });

  it('blocks a dirty workspace including untracked files', async () => {
    const { repo, provider } = await fixture();
    await writeFile(path.join(repo, 'untracked.txt'), 'user work');
    await expect(provider.prepareContext('dirty')).rejects.toMatchObject({
      code: 'WORKTREE_DIRTY',
    });
  });

  it('blocks a conflicting existing task branch', async () => {
    const { repo, provider } = await fixture();
    await git(repo, 'branch', 'agent/task-conflict');
    await expect(provider.prepareContext('conflict')).rejects.toMatchObject({
      code: 'TASK_BRANCH_EXISTS',
    });
  });

  it('does not produce a review ref without a task commit', async () => {
    const { provider } = await fixture();
    await provider.prepareContext('empty');
    await expect(provider.getReviewTarget('empty', 'NOT_RUN')).rejects.toMatchObject({
      code: 'TASK_COMMIT_MISSING',
    });
  });

  it('blocks a non-fast-forward task push and never forces', async () => {
    const { repo, bare, provider } = await fixture();
    await provider.prepareContext('diverged');
    await writeFile(path.join(repo, 'local.txt'), 'first\n');
    await git(repo, 'add', 'local.txt');
    await git(repo, 'commit', '-m', 'first task commit');
    await provider.getReviewTarget('diverged', 'PASS');

    const peer = path.join(path.dirname(repo), 'peer');
    await git(path.dirname(repo), 'clone', bare, peer);
    await git(peer, 'config', 'user.name', 'Peer');
    await git(peer, 'config', 'user.email', 'peer@example.com');
    await git(peer, 'checkout', 'agent/task-diverged');
    await writeFile(path.join(peer, 'peer.txt'), 'remote advance\n');
    await git(peer, 'add', 'peer.txt');
    await git(peer, 'commit', '-m', 'advance remote');
    await git(peer, 'push', 'origin', 'agent/task-diverged');

    await writeFile(path.join(repo, 'local-2.txt'), 'divergent local\n');
    await git(repo, 'add', 'local-2.txt');
    await git(repo, 'commit', '-m', 'diverge locally');
    await expect(provider.getReviewTarget('diverged', 'FAIL')).rejects.toMatchObject({
      code: 'PUSH_NON_FAST_FORWARD',
    });
    expect(await git(repo, 'log', '-1', '--format=%s')).toBe('diverge locally');
  });

  it('rejects malformed durable state on restart', async () => {
    const { repo, provider } = await fixture();
    await provider.prepareContext('broken');
    await writeFile(path.join(repo, '.chatbridge', 'tasks', 'broken.json'), '{"version":999}');
    await expect(new GitHubCodeProvider(new GitRunner(repo)).status('broken')).rejects.toThrow();
  });

  it('rejects non-git, missing remote, and unsupported remote repositories', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codex-duet-invalid-'));
    await expect(new GitHubCodeProvider(new GitRunner(root)).doctor()).rejects.toMatchObject({
      code: 'NOT_GIT_REPOSITORY',
    });
    await git(root, 'init');
    await git(root, 'config', 'user.name', 'Test');
    await git(root, 'config', 'user.email', 'test@example.com');
    await writeFile(path.join(root, 'file'), 'x');
    await git(root, 'add', 'file');
    await git(root, 'commit', '-m', 'base');
    await expect(new GitHubCodeProvider(new GitRunner(root)).doctor()).rejects.toMatchObject({
      code: 'GIT_REMOTE_MISSING',
    });
    await git(root, 'remote', 'add', 'origin', 'https://gitlab.com/example/project.git');
    await expect(new GitHubCodeProvider(new GitRunner(root)).doctor()).rejects.toMatchObject({
      code: 'UNSUPPORTED_GIT_REMOTE',
    });
  });

  it('writes complete JSON atomically without temporary residue', async () => {
    const { repo, provider } = await fixture();
    await provider.prepareContext('atomic');
    const taskFile = path.join(repo, '.chatbridge', 'tasks', 'atomic.json');
    const parsed = JSON.parse(await readFile(taskFile, 'utf8'));
    expect(parsed).toMatchObject({ version: 1, taskId: 'atomic', mode: 'GITHUB' });
    expect(await git(repo, 'status', '--porcelain=v1', '-uall')).toBe('');
  });
});
