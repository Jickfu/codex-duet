import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: mock.execute }));
import { readLocalGit } from '../../src/local/git-reader.js';
import { LOCAL_LIMITS } from '../../src/local/limits.js';

beforeEach(() => {
  mock.execute.mockReset();
});
describe('bounded Git reader', () => {
  it.each([false, true])('maps output overflow with diff=%s to the frozen error', async (diff) => {
    mock.execute.mockImplementation((_command, _args, _options, callback) => {
      callback(
        Object.assign(new Error('stdout maxBuffer exceeded'), {
          code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
        }),
      );
    });
    await expect(readLocalGit('.', ['status'], { diff })).rejects.toMatchObject({
      code: 'SNAPSHOT_LIMIT_EXCEEDED',
    });
    expect(mock.execute.mock.calls[0]?.[2].maxBuffer).toBe(
      diff ? LOCAL_LIMITS.materializedDiffBytes : LOCAL_LIMITS.gitEnumerationBytes,
    );
  });
});
