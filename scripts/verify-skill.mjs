import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
  symlink,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import console from 'node:console';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'skill/codex-duet');
const npm = process.env.npm_execpath;
assert.ok(npm && /^npm-cli\.[cm]?js$/.test(path.basename(npm)), 'Run npm run verify:skill');
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
async function list(dir, prefix = '') {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'package-lock.json') continue;
    assert.ok(!entry.isSymbolicLink(), 'Skill distribution must not contain symlinks');
    const name = prefix + entry.name;
    if (entry.isDirectory()) found.push(...(await list(path.join(dir, entry.name), name + '/')));
    else found.push(name);
  }
  return found;
}
assert.deepEqual((await list(source)).sort(), [...files].sort());
for (const name of ['SKILL.md', 'INSTALL.md', 'references/workflow.md']) {
  const normalize = (text) => text.replaceAll('\r\n', '\n');
  assert.equal(
    normalize(await readFile(path.join(source, name), 'utf8')),
    normalize(await readFile(path.join(root, '.agents/skills/codex-duet', name), 'utf8')),
  );
}
const temp = await mkdtemp(path.join(os.tmpdir(), 'duet skill smoke '));
const installed = path.join(temp, 'codex-duet');
for (const name of files) {
  await mkdir(path.dirname(path.join(installed, name)), { recursive: true });
  await copyFile(path.join(source, name), path.join(installed, name));
}
const run = (args, cwd = installed) =>
  execFileSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 240_000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
  });
assert.throws(() => run([path.join(installed, 'scripts/chatbridge.mjs'), '--version']));
const archive = path.join(installed, 'assets/codex-duet.tgz');
const bytes = await readFile(archive);
const manifest = JSON.parse(await readFile(path.join(installed, 'bundle.json'), 'utf8'));
assert.equal(manifest.sourceDirty, false, 'Build the distribution from committed inputs');
assert.equal(
  manifest.version,
  JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version,
);
assert.equal(manifest.integrity, 'sha512-' + createHash('sha512').update(bytes).digest('base64'));
// A damaged download must fail before dependency installation creates node_modules.
await writeFile(archive, Buffer.concat([bytes, Buffer.from('damage')]));
assert.throws(() => run([npm, 'run', 'setup']));
await assert.rejects(access(path.join(installed, 'node_modules')), { code: 'ENOENT' });
await writeFile(archive, bytes);
run([npm, 'run', 'setup']);
const target = path.join(temp, 'target project');
await mkdir(target);
const launcher = path.join(installed, 'scripts/chatbridge.mjs');
assert.equal(JSON.parse(run([launcher, 'doctor'], target)).ready, true);
assert.equal(run([launcher, '--version'], target).trim(), manifest.version);
assert.ok(run([launcher, 'local', '--help'], target).includes('remote-serve'));
assert.deepEqual(await readdir(target), []);
const git = (args) => execFileSync('git', args, { cwd: target, encoding: 'utf8' });
git(['init', '--quiet']);
await writeFile(path.join(target, 'fixture.txt'), 'downloaded skill cwd fixture\n');
git(['add', 'fixture.txt']);
git([
  '-c',
  'user.name=Skill Fixture',
  '-c',
  'user.email=skill-fixture@example.invalid',
  '-c',
  'commit.gpgsign=false',
  'commit',
  '--quiet',
  '-m',
  'fixture',
]);
run([launcher, 'local', 'init-task', '--task', 'skill-smoke'], target);
await access(path.join(target, '.chatbridge'));
await assert.rejects(access(path.join(installed, '.chatbridge')), { code: 'ENOENT' });
// Exercise the documented natural-language install's actual project-scoped command.
const headBefore = git(['rev-parse', 'HEAD']);
const fixtureBefore = await readFile(path.join(target, 'fixture.txt'));
await writeFile(path.join(target, '.chatbridge/preserve.txt'), 'existing task evidence');
await mkdir(path.join(target, '.agents/skills/other'), { recursive: true });
await writeFile(path.join(target, '.agents/skills/other/SKILL.md'), 'existing unrelated skill');
run([npm, '--prefix', installed, 'run', 'install:project', '--', '--project', target], target);
const projectSkill = path.join(target, '.agents/skills/codex-duet');
assert.equal(
  JSON.parse(run([path.join(projectSkill, 'scripts/chatbridge.mjs'), 'doctor'], target)).ready,
  true,
);
assert.equal(git(['rev-parse', 'HEAD']), headBefore);
assert.deepEqual(await readFile(path.join(target, 'fixture.txt')), fixtureBefore);
assert.equal(
  await readFile(path.join(target, '.chatbridge/preserve.txt'), 'utf8'),
  'existing task evidence',
);
assert.equal(
  await readFile(path.join(target, '.agents/skills/other/SKILL.md'), 'utf8'),
  'existing unrelated skill',
);
const skillBefore = await readFile(path.join(projectSkill, 'SKILL.md'));
assert.throws(() => run([npm, 'run', 'install:project', '--', '--project', target]));
assert.deepEqual(await readFile(path.join(projectSkill, 'SKILL.md')), skillBefore);
await assert.rejects(access(path.join(projectSkill, '.chatbridge')), { code: 'ENOENT' });
const redirected = path.join(temp, 'redirected project');
const outside = path.join(temp, 'outside skills');
await mkdir(redirected);
await mkdir(outside);
await symlink(
  outside,
  path.join(redirected, '.agents'),
  process.platform === 'win32' ? 'junction' : 'dir',
);
assert.throws(() => run([npm, 'run', 'install:project', '--', '--project', redirected]));
assert.deepEqual(await readdir(outside), []);
// Ensure the checked-in runtime is current, even if the version number did not change.
const currentFiles = await list(path.join(root, 'dist'));
assert.deepEqual(
  (await list(path.join(installed, 'node_modules/codex-duet/dist'))).sort(),
  [...currentFiles].sort(),
);
for (const name of currentFiles) {
  // TypeScript preserves checkout newlines inside multiline script literals.
  // Normalize only physical CRLF; escaped characters and all other bytes still differ.
  assert.equal(
    (await readFile(path.join(root, 'dist', name), 'utf8')).replaceAll('\r\n', '\n'),
    (await readFile(path.join(installed, 'node_modules/codex-duet/dist', name), 'utf8')).replaceAll(
      '\r\n',
      '\n',
    ),
    `Stale bundled runtime: ${name}`,
  );
}
console.log(
  JSON.stringify(
    {
      skill: 'PASS',
      integrity: manifest.integrity,
      temp,
      corruptedDownloadRejected: true,
      callerDirectoryPreserved: true,
      projectInstallVerified: true,
      existingSkillPreserved: true,
    },
    null,
    2,
  ),
);
