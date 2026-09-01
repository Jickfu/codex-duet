import { describe, expect, it } from 'vitest';
import { parseGitHubRemote, taskBranchFor, TaskIdSchema } from '../../src/github/domain.js';

describe('GitHub domain validation', () => {
  it.each([
    ['https://github.com/owner/repo.git', 'owner/repo'],
    ['git@github.com:owner/repo.git', 'owner/repo'],
    ['ssh://git@github.com/owner/repo.git', 'owner/repo'],
  ])('parses %s', (url, expected) => expect(parseGitHubRemote(url)).toBe(expected));

  it.each(['https://gitlab.com/a/b.git', 'file:///tmp/repo.git', 'owner/repo', ''])(
    'rejects unsupported remote %s',
    (url) => expect(() => parseGitHubRemote(url)).toThrow('UNSUPPORTED_GIT_REMOTE'),
  );

  it.each(['abc;rm', '../../main', 'foo bar', 'foo&&whoami', '$(whoami)', '%COMSPEC%', 'a/b'])(
    'rejects injected task ID %s',
    (taskId) => expect(() => TaskIdSchema.parse(taskId)).toThrow(),
  );

  it('derives the branch instead of accepting one from callers', () => {
    expect(taskBranchFor('safe_1')).toBe('agent/task-safe_1');
  });
});
