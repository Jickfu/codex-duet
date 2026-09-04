import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';
import console from 'node:console';
import { result, evidence } from './verify-package.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = path.join(root, 'skill', 'codex-duet');
await mkdir(path.join(bundle, 'assets'), { recursive: true });
await mkdir(path.join(bundle, 'references'), { recursive: true });
for (const name of ['SKILL.md', 'INSTALL.md', 'references/workflow.md']) {
  await copyFile(path.join(root, '.agents/skills/codex-duet', name), path.join(bundle, name));
}
await copyFile(path.join(evidence, result.package), path.join(bundle, 'assets/codex-duet.tgz'));
await writeFile(
  path.join(bundle, 'bundle.json'),
  JSON.stringify(
    {
      version: result.version,
      integrity: result.integrity,
      sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
      sourceDirty: Boolean(
        execFileSync(
          'git',
          [
            'status',
            '--porcelain',
            '--',
            'src',
            'docs',
            'package.json',
            'pnpm-lock.yaml',
            'tsconfig.build.json',
            'tsconfig.json',
            'README.md',
            'LICENSE',
          ],
          { cwd: root, encoding: 'utf8' },
        ).trim(),
      ),
    },
    null,
    2,
  ) + '\n',
);
console.log(`Verified skill runtime written to ${bundle}`);
