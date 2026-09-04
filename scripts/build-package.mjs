import { execFileSync } from 'node:child_process';
import { lstat, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const output = path.join(root, 'dist');
// Only the disposable output directly inside this checkout may be removed.
try {
  const info = await lstat(output);
  if (info.isSymbolicLink() || !info.isDirectory() || (await realpath(output)) !== output)
    throw new Error('Refusing to replace a non-directory or redirected dist');
  await rm(output, { recursive: true });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const require = createRequire(import.meta.url);
execFileSync(
  process.execPath,
  [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'],
  {
    cwd: root,
    stdio: 'inherit',
  },
);
