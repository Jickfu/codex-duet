import { lstat, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readLocalGit } from './git-reader.js';
import { resolveWorkspacePath } from './path-policy.js';
import { isSensitiveWorkspacePath } from './sensitive-policy.js';
import { LOCAL_LIMITS } from './limits.js';
import { ChatbridgeError } from '../core/errors.js';

/** Private policy sources contribute hashes only; no external rule bytes are exposed. */
export async function captureIgnorePolicy(root: string) {
  let totalBytes = 0;
  async function fingerprint(file: string) {
    try {
      const before = await lstat(file);
      if (!before.isFile() || before.isSymbolicLink())
        throw new ChatbridgeError(
          'Ignore policy must be a regular file',
          'LOCAL_IGNORE_POLICY_UNSUPPORTED',
        );
      if (
        before.size > LOCAL_LIMITS.singleFileBytes ||
        totalBytes + before.size > LOCAL_LIMITS.capturedBytes
      )
        throw new ChatbridgeError('Ignore policy exceeds limit', 'SNAPSHOT_LIMIT_EXCEEDED');
      const bytes = await readFile(file);
      const after = await lstat(file);
      if (
        before.ino !== after.ino ||
        before.size !== bytes.length ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs
      )
        throw new ChatbridgeError('Ignore policy changed', 'SNAPSHOT_SOURCE_CHANGED');
      totalBytes += bytes.length;
      return createHash('sha256').update(bytes).digest('hex');
    } catch (error: any) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }
  const info = (await readLocalGit(root, ['rev-parse', '--git-path', 'info/exclude'])).trim();
  const configured = (
    await readLocalGit(root, ['config', '--path', '--get', 'core.excludesFile'], {
      acceptDifference: true,
    })
  ).trim();
  const global =
    configured ||
    path.join(
      process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || os.homedir(), '.config'),
      'git',
      'ignore',
    );
  // No --exclude-standard: even ignored .gitignore rule files must bind the policy.
  const names = [
    ...new Set(
      (
        await readLocalGit(
          root,
          ['ls-files', '--cached', '--others', '-z', '--', '.gitignore', '**/.gitignore'],
          { glob: true },
        )
      )
        .split('\0')
        .filter((name) => name && !isSensitiveWorkspacePath(name)),
    ),
  ].sort();
  if (names.length > LOCAL_LIMITS.files)
    throw new ChatbridgeError('Too many ignore files', 'SNAPSHOT_LIMIT_EXCEEDED');
  const workspace = [];
  for (const name of names) {
    try {
      const resolved = await resolveWorkspacePath(root, name);
      workspace.push({ name, sha256: await fingerprint(resolved.absolutePath) });
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
      workspace.push({ name, sha256: null });
    }
  }
  return {
    version: 1,
    info: await fingerprint(path.resolve(root, info)),
    global: await fingerprint(path.resolve(root, global)),
    // Hash the effective location too, without exposing private absolute paths.
    globalSource: createHash('sha256').update(path.resolve(root, global)).digest('hex'),
    workspace,
  };
}
