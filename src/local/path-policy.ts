import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { ChatbridgeError } from '../core/errors.js';

const DEVICE_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function validateWorkspaceRelativePath(value: string): string {
  if (!value || value.includes('\\') || value.includes('\0') || value.includes(':'))
    throw invalidPath();
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.startsWith('//'))
    throw invalidPath();
  const segments = value.split('/');
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        segment.endsWith('.') ||
        segment.endsWith(' ') ||
        DEVICE_NAMES.test(segment),
    )
  )
    throw invalidPath();
  return segments.join('/');
}

export async function resolveWorkspacePath(
  canonicalRoot: string,
  relativePath: string,
  options: { allowFinalSymlink?: boolean } = {},
): Promise<{ relativePath: string; absolutePath: string; symlink: boolean }> {
  const normalized = validateWorkspaceRelativePath(relativePath);
  const root = await realpath(canonicalRoot);
  const segments = normalized.split('/');
  let current = root;
  let symlink = false;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) {
      symlink = true;
      if (index !== segments.length - 1 || !options.allowFinalSymlink)
        throw new ChatbridgeError(
          'Workspace links are not traversable',
          'LOCAL_PATH_LINK_REJECTED',
        );
    }
  }
  const resolved = symlink ? current : await realpath(current);
  const rootWithSeparator = `${path.resolve(root)}${path.sep}`.toLowerCase();
  if (!`${path.resolve(resolved)}${path.sep}`.toLowerCase().startsWith(rootWithSeparator))
    throw new ChatbridgeError('Workspace path escapes the configured root', 'LOCAL_PATH_ESCAPE');
  return { relativePath: normalized, absolutePath: current, symlink };
}

function invalidPath(): ChatbridgeError {
  return new ChatbridgeError('Invalid workspace-relative POSIX path', 'LOCAL_PATH_INVALID');
}
