import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
assert.ok(Number(process.versions.node.split('.')[0]) >= 20, 'Node 20+ is required');
const npm = process.env.npm_execpath;
assert.ok(npm && /^npm-cli\.[cm]?js$/.test(path.basename(npm)), 'Run npm run setup');
const manifest = JSON.parse(await readFile(new URL('../bundle.json', import.meta.url), 'utf8'));
const bytes = await readFile(new URL('../assets/codex-duet.tgz', import.meta.url));
assert.equal(
  'sha512-' + createHash('sha512').update(bytes).digest('base64'),
  manifest.integrity,
  'Bundled runtime integrity mismatch; download the complete skill again',
);
execFileSync(process.execPath, [npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund'], {
  cwd: root,
  stdio: 'inherit',
  timeout: 180_000,
  env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
});
const installed = JSON.parse(
  await readFile(new URL('../node_modules/codex-duet/package.json', import.meta.url), 'utf8'),
);
assert.equal(installed.version, manifest.version);
