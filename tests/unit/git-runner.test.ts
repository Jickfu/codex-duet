import { describe, expect, it, vi } from 'vitest';
import { GitRunner, type GitExecutor } from '../../src/github/git-runner.js';

describe('GitRunner', () => {
  it('always invokes git with an argument array and no shell', async () => {
    const executor = vi.fn<GitExecutor>(async () => ({ stdout: ' ok \n', stderr: '' }));
    const runner = new GitRunner('/safe/repo', 123, 456, executor);
    expect(await runner.run(['status', '--short'])).toEqual({ stdout: 'ok', stderr: '' });
    expect(executor).toHaveBeenCalledWith('git', ['status', '--short'], {
      cwd: '/safe/repo',
      timeout: 123,
      maxBuffer: 456,
      windowsHide: true,
    });
    expect(executor.mock.calls[0]?.[2]).not.toHaveProperty('shell');
  });

  it('sanitizes credentials in errors', async () => {
    const executor = vi.fn<GitExecutor>(async () => {
      throw { code: 1, stderr: 'fatal https://secret@github.com token=abc' };
    });
    await expect(new GitRunner('/repo', 1, 1, executor).run(['fetch'])).rejects.toMatchObject({
      code: 'GIT_COMMAND_FAILED',
      message: expect.not.stringContaining('secret'),
    });
  });
});
