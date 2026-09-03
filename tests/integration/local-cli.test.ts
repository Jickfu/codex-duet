import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { beforeEach, describe, expect, it } from 'vitest';
import { registerLocalCommands } from '../../src/cli/local.js';

const execute = promisify(execFile);
let root: string;
async function git(...args: string[]) {
  return (await execute('git', args, { cwd: root })).stdout;
}
async function cli(...args: string[]): Promise<any> {
  const program = new Command().exitOverride();
  let result: unknown;
  registerLocalCommands(
    program,
    () => root,
    (value) => {
      result = value;
    },
  );
  await program.parseAsync(['local', ...args], { from: 'user' });
  return result;
}
async function evidenceFile(snapshotId: string, iteration = 1, taskId = 'demo') {
  const identity = { version: 1, taskId, iteration, snapshotId };
  const file = path.join(root, '.chatbridge', 'input.json');
  await writeFile(
    file,
    JSON.stringify({
      tests: {
        ...identity,
        status: 'PASS',
        summary: 'Caller fixture evidence',
        recordedAt: new Date(0).toISOString(),
      },
      execution: { ...identity, summary: 'Caller changed tracked.txt' },
    }),
  );
  return file;
}
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'local-cli-'));
  await git('init');
  await git('config', 'user.name', 'Fixture');
  await git('config', 'user.email', 'fixture@example.test');
  await writeFile(path.join(root, 'tracked.txt'), 'baseline\n');
  await git('add', 'tracked.txt');
  await git('commit', '-m', 'baseline');
});

describe('LOCAL CLI data-plane integration', () => {
  it('preserves dirty work and Git refs through multi-round capture, evidence and recovery', async () => {
    const head = await git('rev-parse', 'HEAD');
    const refs = await git('show-ref');
    await writeFile(path.join(root, 'tracked.txt'), 'pre-existing dirty baseline\n');
    const baseline = await cli('init-task', '--task', 'demo');
    expect(baseline.mode).toBe('LOCAL');
    expect(await cli('init-task', '--task', 'demo')).toEqual(baseline);
    await expect(cli('assert-ready', '--task', 'demo')).resolves.toMatchObject({ unchanged: true });
    let previous: string | undefined;
    for (const iteration of [1, 2]) {
      await writeFile(path.join(root, 'tracked.txt'), `round ${iteration}\n`);
      const candidate = await cli('capture', '--task', 'demo');
      const file = await evidenceFile(candidate.snapshotId, iteration);
      const record = ['record-evidence', '--task', 'demo', '--evidence-file', file];
      await cli(...record);
      await cli(...record);
      const args = ['prepare-review', '--task', 'demo', '--iteration', String(iteration)];
      const target = await cli(...args);
      expect(target).toMatchObject({
        baselineSnapshotId: baseline.baselineSnapshotId,
        reviewSnapshotId: candidate.snapshotId,
        iteration,
        testStatus: 'PASS',
      });
      expect(target.previousReviewSnapshotId).toBe(previous);
      expect(target).not.toHaveProperty('reviewRef');
      expect(await cli(...args)).toEqual(target);
      previous = target.reviewSnapshotId;
      await expect(cli('assert-ready', '--task', 'demo')).resolves.toMatchObject({
        unchanged: true,
      });
    }
    expect((await cli('status', '--task', 'demo')).reviews).toHaveLength(2);
    await writeFile(path.join(root, 'tracked.txt'), 'unreviewed later edit\n');
    const later = await cli('capture', '--task', 'demo');
    const replacement = await evidenceFile(later.snapshotId, 2);
    await expect(
      cli('record-evidence', '--task', 'demo', '--evidence-file', replacement),
    ).rejects.toMatchObject({ code: 'LOCAL_REVIEW_REPLAY_DIVERGED' });
    expect(
      (await cli('prepare-review', '--task', 'demo', '--iteration', '2')).reviewSnapshotId,
    ).toBe(previous);
    expect(await git('rev-parse', 'HEAD')).toBe(head);
    expect(await git('show-ref')).toBe(refs);
    expect(await git('remote')).toBe('');
    expect(await git('diff', '--cached')).toBe('');
    expect(await git('diff')).toContain('unreviewed later edit');
  }, 60_000);

  it('fails closed on missing context, foreign evidence, skipped iteration and post-test drift', async () => {
    await expect(cli('capture', '--task', 'demo')).rejects.toMatchObject({
      code: 'TASK_NOT_FOUND',
    });
    const baseline = await cli('init-task', '--task', 'demo');
    let file = await evidenceFile(baseline.baselineSnapshotId, 1, 'other');
    await expect(
      cli('record-evidence', '--task', 'demo', '--evidence-file', file),
    ).rejects.toMatchObject({ code: 'LOCAL_EVIDENCE_IDENTITY_MISMATCH' });
    file = await evidenceFile(baseline.baselineSnapshotId, 3);
    await expect(
      cli('record-evidence', '--task', 'demo', '--evidence-file', file),
    ).rejects.toMatchObject({ code: 'LOCAL_ITERATION_MISMATCH' });
    file = await evidenceFile(baseline.baselineSnapshotId);
    await writeFile(path.join(root, 'tracked.txt'), 'changed after candidate\n');
    await expect(
      cli('record-evidence', '--task', 'demo', '--evidence-file', file),
    ).rejects.toThrow();
    await expect(cli('assert-ready', '--task', 'demo')).rejects.toThrow();
    await expect(cli('prepare-review', '--task', 'demo', '--iteration', '1')).rejects.toThrow();
    await expect(cli('prepare-review', '--task', 'demo', '--iteration', 'NaN')).rejects.toThrow();
    expect((await cli('status', '--task', 'demo')).reviews).toEqual([]);
  }, 30_000);
});
