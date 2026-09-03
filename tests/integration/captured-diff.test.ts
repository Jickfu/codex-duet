import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { capturedFileDiff, quoteGitPath } from '../../src/local/captured-diff.js';

describe('captured patches round-trip through real Git', () => {
  it('uses Git byte escapes for control characters', () => {
    expect(quoteGitPath('a/\u001b\t.txt')).toBe('"a/\\033\\011.txt"');
  });
  it.each(['text', 'crlf', 'binary', 'addition', 'deletion'])(
    '%s keeps logical paths and exact content',
    async (kind) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'captured-patch-'));
      const name = '中文 name.txt';
      const before =
        kind === 'addition'
          ? undefined
          : {
              bytes: Buffer.from(
                kind === 'binary' ? [0, 255, 1] : kind === 'crlf' ? 'before\r\n' : 'before\n',
              ),
              executable: false,
            };
      const after =
        kind === 'deletion'
          ? undefined
          : {
              bytes: Buffer.from(
                kind === 'binary'
                  ? [0, 253, 2, 4]
                  : kind === 'crlf'
                    ? 'after\r\n'
                    : 'after\n--- a/before\n+++ b/after\n',
              ),
              executable: false,
            };
      if (before) await writeFile(path.join(root, name), before.bytes);
      const patch = await capturedFileDiff(name, before, after);
      await new Promise<void>((resolve, reject) => {
        const child = execFile(
          'git',
          ['-c', 'core.autocrlf=false', 'apply', '--binary', '-'],
          { cwd: root },
          (error) => (error ? reject(error) : resolve()),
        );
        child.stdin!.end(patch);
      });
      if (after) expect(await readFile(path.join(root, name))).toEqual(after.bytes);
      else await expect(readFile(path.join(root, name))).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );
});
