import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { onboarding } from '../../src/cli/onboarding.js';

async function fixture() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'duet-onboard-'));
  const git = async (args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  await git(['init', '--quiet']);
  await writeFile(path.join(cwd, 'readme.txt'), 'fixture');
  await git(['add', '.']);
  const commit = () =>
    git([
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ]);
  await commit();
  const dependencies = {
    git,
    installation: async () => ({ ready: true, checks: [], scope: 'fixture' }),
  };
  return { cwd, git, commit, dependencies };
}

describe('first-use onboarding', () => {
  it('rejects uncommitted contracts, lists external work and preserves the repository', async () => {
    const f = await fixture();
    await mkdir(path.join(f.cwd, 'docs/contracts'), { recursive: true });
    for (const role of ['planner', 'reviewer'])
      await writeFile(path.join(f.cwd, `docs/contracts/${role}-v1.md`), 'contract');
    const before = await f.git(['status', '--porcelain=v1', '-uall']);
    const head = await f.git(['rev-parse', 'HEAD']);
    const report = await onboarding('github', f.cwd, f.dependencies);
    expect(report.localPrerequisitesReady).toBe(false);
    expect(
      report.checks.filter((c) => c.name.startsWith('docs/')).every((c) => c.status === 'FAIL'),
    ).toBe(true);
    expect(report.checks.find((c) => c.name === 'origin')?.status).toBe('FAIL');
    expect(report.checks.find((c) => c.name === 'browser')?.status).toBe('REQUIRED');
    expect(await f.git(['status', '--porcelain=v1', '-uall'])).toBe(before);
    expect(await f.git(['rev-parse', 'HEAD'])).toBe(head);
    expect(await readdir(f.cwd)).not.toContain('.chatbridge');
  });
  it('checks mode-specific committed contracts without requiring a LOCAL remote or clean tree', async () => {
    const f = await fixture();
    await mkdir(path.join(f.cwd, 'docs/contracts'), { recursive: true });
    for (const prefix of ['', 'local-'])
      for (const role of ['planner', 'reviewer'])
        await writeFile(path.join(f.cwd, `docs/contracts/${prefix}${role}-v1.md`), 'contract');
    await f.git(['add', '.']);
    await f.commit();
    await f.git(['remote', 'add', 'origin', 'https://github.com/example/fixture.git']);
    const github = await onboarding('github', f.cwd, f.dependencies);
    expect(github.localPrerequisitesReady).toBe(true);
    expect(github.taskReady).toBe(false);
    await writeFile(path.join(f.cwd, 'readme.txt'), 'dirty work');
    expect((await onboarding('github', f.cwd, f.dependencies)).localPrerequisitesReady).toBe(false);
    await f.git(['remote', 'remove', 'origin']);
    expect((await onboarding('local', f.cwd, f.dependencies)).localPrerequisitesReady).toBe(true);
  });
  it('does not echo Git errors or remote credentials and reports independent failures', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'duet-onboard-errors-'));
    const report = await onboarding('github', cwd, {
      installation: async () => ({ ready: false, checks: [], scope: 'fixture' }),
      git: async () => {
        throw new Error('https://secret:password@github.com/private/repo');
      },
    });
    expect(report.localPrerequisitesReady).toBe(false);
    expect(report.checks.filter((c) => c.status === 'FAIL')).toHaveLength(7);
    expect(JSON.stringify(report)).not.toMatch(/secret|password|private\/repo/);
    expect(await readdir(cwd)).toEqual([]);
  });
});
