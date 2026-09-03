import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readLocalGit } from './git-reader.js';

export type CapturedFile = { bytes: Buffer; executable: boolean };

/** Only two fixed regular files exist in this isolated directory. No pathspec security boundary. */
export async function capturedFileDiff(
  name: string,
  before?: CapturedFile,
  after?: CapturedFile,
): Promise<string> {
  if (!before && !after) return '';
  if (before && after && before.executable === after.executable && before.bytes.equals(after.bytes))
    return '';
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'chatbridge-diff-'));
  try {
    for (const [file, value] of [
      ['before', before],
      ['after', after],
    ] as const) {
      if (!value) continue;
      await writeFile(path.join(temporary, file), value.bytes);
      await chmod(path.join(temporary, file), value.executable ? 0o755 : 0o644);
    }
    const raw = await readLocalGit(
      temporary,
      [
        '-c',
        'core.attributesFile=/dev/null',
        'diff',
        '--no-index',
        '--no-ext-diff',
        '--no-textconv',
        '--no-renames',
        '--binary',
        '--no-color',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        '--',
        before ? 'before' : '/dev/null',
        after ? 'after' : '/dev/null',
      ],
      { diff: true, acceptDifference: true },
    );
    if (!raw) return '';
    const lines = raw.split('\n');
    lines[0] = `diff --git ${JSON.stringify(`a/${name}`)} ${JSON.stringify(`b/${name}`)}`;
    // Rewrite only metadata before the first hunk/binary payload, never source lines.
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]!.startsWith('@@') || lines[i] === 'GIT binary patch') break;
      if (lines[i] === '--- a/before') lines[i] = `--- ${JSON.stringify(`a/${name}`)}`;
      if (lines[i] === '+++ b/after') lines[i] = `+++ ${JSON.stringify(`b/${name}`)}`;
    }
    return lines.join('\n');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
