import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { fileURLToPath, URL } from 'node:url';

assert.ok(
  process.argv.length === 4 && process.argv[2] === '--project',
  'Usage: npm run install:project -- --project <absolute-project-directory>',
);
assert.ok(path.isAbsolute(process.argv[3]), 'Project directory must be absolute');
assert.ok(Number(process.versions.node.split('.')[0]) >= 20, 'Node 20+ is required');
const npm = process.env.npm_execpath;
assert.ok(npm && /^npm-cli\.[cm]?js$/.test(path.basename(npm)), 'Use npm run install:project');
const project = await realpath(process.argv[3]);
assert.ok((await lstat(project)).isDirectory(), 'Project must be an existing directory');
execFileSync('git', ['--version'], { stdio: 'pipe', timeout: 5000 });
const source = fileURLToPath(new URL('../', import.meta.url));
const files = [
  'SKILL.md',
  'INSTALL.md',
  'references/workflow.md',
  'package.json',
  'bundle.json',
  '.gitignore',
  'assets/codex-duet.tgz',
  'scripts/install.mjs',
  'scripts/chatbridge.mjs',
  'scripts/install-project.mjs',
];
for (const name of files) {
  const info = await lstat(path.join(source, name));
  assert.ok(info.isFile() && !info.isSymbolicLink(), `Missing or redirected bundle file: ${name}`);
}
// Resolve each parent independently. Never follow a project's redirected skill location.
for (const relative of ['.agents', '.agents/skills']) {
  const parent = path.join(project, relative);
  try {
    await mkdir(parent);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const info = await lstat(parent);
  assert.ok(
    info.isDirectory() && !info.isSymbolicLink() && (await realpath(parent)) === parent,
    `Refusing redirected skill parent: ${parent}`,
  );
}
const destination = path.join(project, '.agents/skills/codex-duet');
// Exclusive creation also rejects an empty existing directory or dangling symlink.
try {
  await mkdir(destination);
} catch (error) {
  if (error.code === 'EEXIST')
    throw new Error(`Skill already exists; left unchanged: ${destination}`);
  throw error;
}
try {
  for (const name of files) {
    await mkdir(path.dirname(path.join(destination, name)), { recursive: true });
    await copyFile(path.join(source, name), path.join(destination, name), constants.COPYFILE_EXCL);
  }
  execFileSync(process.execPath, [npm, 'run', 'setup'], {
    cwd: destination,
    stdio: 'inherit',
    timeout: 240_000,
    env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
  });
  const doctor = execFileSync(
    process.execPath,
    [path.join(destination, 'scripts/chatbridge.mjs'), 'doctor'],
    { cwd: project, encoding: 'utf8', timeout: 15_000 },
  );
  assert.equal(JSON.parse(doctor).ready, true);
  console.log(
    JSON.stringify({ status: 'INSTALLED', skillDirectory: destination, doctor: 'PASS' }, null, 2),
  );
} catch (error) {
  console.error(
    `Installation incomplete. Files retained for inspection at ${destination}. No existing skill was replaced.`,
  );
  throw error;
}
