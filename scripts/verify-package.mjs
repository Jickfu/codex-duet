import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import os from 'node:os';
import { fileURLToPath, URL } from 'node:url';
import console from 'node:console';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.env.npm_execpath;
if (!npm || !/^npm-cli\.[cm]?js$/.test(path.basename(npm)))
  throw new Error('Run this source-checkout check with npm run verify:package');
const runNpm = (args, cwd = root) =>
  execFileSync(process.execPath, [npm, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
  });
await mkdir(path.join(root, '.chatbridge'), { recursive: true });
const evidence = await mkdtemp(path.join(root, '.chatbridge', 'package-check-'));
// prepack must rebuild; pack contents are checked before any installation.
const packOutput = JSON.parse(runNpm(['pack', '--json', '--pack-destination', evidence]));
const packed = Array.isArray(packOutput) ? packOutput : Object.values(packOutput);
assert.equal(packed.length, 1);
const manifest = packed[0];
const paths = new Set(manifest.files.map((file) => file.path));
for (const name of paths) {
  assert.ok(
    name === 'package.json' ||
      name === 'README.md' ||
      name === 'README.zh-CN.md' ||
      name === 'INSTALL.md' ||
      name === 'LICENSE' ||
      /^docs\/[\w./-]+\.md$/.test(name) ||
      /^dist\/[\w/-]+(?:\.d\.ts|\.js|\.js\.map)$/.test(name),
    `Unexpected package entry: ${name}`,
  );
  if (name.startsWith('dist/')) {
    const source = name.replace(/^dist\//, 'src/').replace(/(?:\.d\.ts|\.js(?:\.map)?)$/, '.ts');
    await access(path.join(root, source));
  }
}
for (const name of [
  'dist/cli/index.js',
  'dist/local/tunnel-supervisor.js',
  'docs/local-mode.md',
  'LICENSE',
])
  assert.ok(paths.has(name), `Missing package entry: ${name}`);
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
assert.equal(manifest.version, pkg.version);
assert.ok(!path.basename(manifest.filename).includes('..'));
assert.equal(path.basename(manifest.filename), manifest.filename);
// Outside the checkout so Node cannot accidentally resolve missing dependencies from it.
const install = await mkdtemp(path.join(os.tmpdir(), 'codex-duet-install-'));
// No global install, browser download, lifecycle scripts, application state or network service.
runNpm(
  [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    '--prefix',
    install,
    path.join(evidence, manifest.filename),
  ],
  install,
);
const installedRoot = path.join(install, 'node_modules', pkg.name);
const installed = JSON.parse(await readFile(path.join(installedRoot, 'package.json'), 'utf8'));
assert.equal(installed.version, pkg.version);
const cli = path.join(installedRoot, installed.bin.chatbridge);
await access(
  path.join(
    install,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'chatbridge.cmd' : 'chatbridge',
  ),
);
for (const args of [
  ['--version'],
  ['--help'],
  ['local', '--help'],
  ['browser', '--help'],
  ['doctor'],
]) {
  const output = execFileSync(process.execPath, [cli, ...args], {
    cwd: install,
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.ok(output.trim());
  if (args[0] === '--version') assert.equal(output.trim(), pkg.version);
  if (args[0] === 'doctor') assert.equal(JSON.parse(output).ready, true);
  if (args[0] === 'local')
    assert.ok(output.includes('remote-serve') && output.includes('reviewer-handoff'));
}
await assert.rejects(access(path.join(install, '.chatbridge')), { code: 'ENOENT' });
const result = {
  version: pkg.version,
  node: process.version,
  platform: process.platform,
  package: manifest.filename,
  integrity: manifest.integrity,
  files: paths.size,
  installedCli: 'PASS',
  installationDirectory: install,
  browserDownloads: false,
  published: false,
};
await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, evidence }, null, 2));
export { result, evidence };
