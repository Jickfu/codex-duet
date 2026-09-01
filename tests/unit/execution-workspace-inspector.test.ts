import { describe, expect, it, vi } from 'vitest';
import { GitExecutionWorkspaceInspector } from '../../src/duet/execution-workspace-inspector.js';

describe('GitExecutionWorkspaceInspector', () => {
  it('uses only the frozen read-only Git command set and detects conflicts', async () => {
    const calls: readonly string[][] = [];
    const run = vi.fn(async (args: readonly string[]) => {
      (calls as string[][]).push([...args]);
      if (args[0] === 'symbolic-ref') return { stdout: 'agent/task-demo', stderr: '' };
      if (args[0] === 'rev-parse') return { stdout: 'a'.repeat(40), stderr: '' };
      if (args[0] === 'status') return { stdout: 'UU file.txt', stderr: '' };
      return { stdout: 'file.txt', stderr: '' };
    });
    const inspector = new GitExecutionWorkspaceInspector({ run });
    expect(await inspector.inspect()).toEqual({
      branch: 'agent/task-demo',
      head: 'a'.repeat(40),
      clean: false,
      conflicted: true,
    });
    expect(calls).toEqual([
      ['symbolic-ref', '--quiet', '--short', 'HEAD'],
      ['rev-parse', '--verify', 'HEAD'],
      ['status', '--porcelain=v1', '-uall'],
      ['diff', '--name-only', '--diff-filter=U'],
    ]);
    expect(calls.flat()).not.toEqual(
      expect.arrayContaining([
        'checkout',
        'reset',
        'clean',
        'stash',
        'commit',
        'push',
        'merge',
        'rebase',
      ]),
    );
  });

  it('uses merge-base only for ancestry and returns false on rejection', async () => {
    const run = vi.fn(async () => {
      throw new Error('not ancestor');
    });
    const inspector = new GitExecutionWorkspaceInspector({ run });
    expect(await inspector.isAncestor('a'.repeat(40), 'b'.repeat(40))).toBe(false);
    expect(run).toHaveBeenCalledWith([
      'merge-base',
      '--is-ancestor',
      'a'.repeat(40),
      'b'.repeat(40),
    ]);
  });
});
