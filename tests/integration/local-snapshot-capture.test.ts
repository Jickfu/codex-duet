import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, unlink, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { GitLocalSnapshotAuthority } from '../../src/local/git-snapshot-authority.js';
import { LocalWorkspaceService } from '../../src/local/workspace-service.js';
import { LocalEvidenceStore } from '../../src/local/evidence-store.js';
import { LocalCodeProvider } from '../../src/local/local-code-provider.js';

const execute = promisify(execFile);
let root: string;
async function git(...args: string[]) {
  return execute('git', args, { cwd: root });
}
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'local-capture-'));
  await git('init');
  await git('config', 'user.name', 'Local Test');
  await git('config', 'user.email', 'local@example.test');
  await writeFile(path.join(root, 'tracked.txt'), 'original\n');
  await git('add', 'tracked.txt');
  await git('commit', '-m', 'baseline');
});

describe('real LOCAL snapshot capture', () => {
  it('captures a pre-existing dirty baseline without commit or remote and closes its bytes', async () => {
    await writeFile(path.join(root, 'tracked.txt'), 'dirty baseline\n');
    await writeFile(path.join(root, 'untracked.txt'), 'new file\n');
    await writeFile(path.join(root, '.env'), 'TOKEN=private');
    const authority = await GitLocalSnapshotAuthority.open(root, 'demo');
    const baseline = await authority.capture('demo');
    expect((await authority.capture('demo')).snapshotId).toBe(baseline.snapshotId);
    const reader = new LocalWorkspaceService(authority.store);
    const before = await reader.readFile({
      taskId: 'demo',
      snapshotId: baseline.snapshotId,
      path: 'tracked.txt',
    });
    expect(Buffer.from(before.content, 'base64').toString()).toBe('dirty baseline\n');
    expect(
      JSON.stringify(
        await reader.workspaceInfo({ taskId: 'demo', snapshotId: baseline.snapshotId }),
      ),
    ).not.toContain(root);
    expect(
      JSON.stringify(
        await reader.listDirectory({ taskId: 'demo', snapshotId: baseline.snapshotId }),
      ),
    ).not.toContain('.env');
    await writeFile(path.join(root, 'tracked.txt'), 'later\n');
    expect(
      await reader.readFile({
        taskId: 'demo',
        snapshotId: baseline.snapshotId,
        path: 'tracked.txt',
      }),
    ).toEqual(before);
    await expect(authority.assertLiveSnapshot(baseline.snapshotId)).rejects.toMatchObject({
      code: 'LOCAL_BASELINE_DRIFT',
    });
  });

  it('captures staged changes and deletion, preserves HEAD, and filters denied diff paths', async () => {
    const head = (await git('rev-parse', 'HEAD')).stdout.trim();
    await writeFile(path.join(root, 'added.txt'), 'added\n');
    await writeFile(path.join(root, '.env'), 'SECRET=hidden');
    await git('add', 'added.txt', '.env');
    await unlink(path.join(root, 'tracked.txt'));
    const authority = await GitLocalSnapshotAuthority.open(root, 'demo');
    const snapshot = await authority.capture('demo');
    const reader = new LocalWorkspaceService(authority.store);
    const diff = await reader.gitDiff({ taskId: 'demo', snapshotId: snapshot.snapshotId });
    const content = Buffer.from(diff.content, 'base64').toString();
    expect(content).toContain('added.txt');
    expect(content).toContain('deleted file');
    expect(content).not.toContain('.env');
    expect(content).not.toContain('SECRET');
    expect((await git('rev-parse', 'HEAD')).stdout.trim()).toBe(head);
  });

  it('connects real capture, immutable evidence, and multi-round provider without a push', async () => {
    const authority = await GitLocalSnapshotAuthority.open(root, 'demo');
    const evidence = new LocalEvidenceStore(path.join(root, '.chatbridge'));
    const provider = new LocalCodeProvider(authority, evidence, path.join(root, '.chatbridge'));
    const context = await provider.prepareContext('demo');
    await provider.assertReadyForIteration('demo');
    await writeFile(path.join(root, 'tracked.txt'), 'implemented\n');
    const candidate = await authority.capture('demo');
    await evidence.record(
      {
        version: 1,
        taskId: 'demo',
        iteration: 1,
        snapshotId: candidate.snapshotId,
        status: 'PASS',
        summary: 'fixture verification',
        recordedAt: '2026-09-03T00:00:00.000Z',
      },
      {
        version: 1,
        taskId: 'demo',
        iteration: 1,
        snapshotId: candidate.snapshotId,
        summary: 'updated tracked file',
      },
      authority,
    );
    const target = await provider.prepareReview({ taskId: 'demo', iteration: 1 });
    expect(target.baselineSnapshotId).toBe(context.baselineSnapshotId);
    expect(target.reviewSnapshotId).toBe(candidate.snapshotId);
    expect(await provider.prepareReview({ taskId: 'demo', iteration: 1 })).toEqual(target);
    await expect(
      (await GitLocalSnapshotAuthority.open(root, 'demo')).capture('demo'),
    ).resolves.toMatchObject({ snapshotId: candidate.snapshotId });
    await writeFile(path.join(root, 'tracked.txt'), 'changed after tests\n');
    await expect(
      evidence.record(
        {
          version: 1,
          taskId: 'demo',
          iteration: 2,
          snapshotId: candidate.snapshotId,
          status: 'PASS',
          summary: 'stale',
          recordedAt: '2026-09-03T00:00:00.000Z',
        },
        {
          version: 1,
          taskId: 'demo',
          iteration: 2,
          snapshotId: candidate.snapshotId,
          summary: 'stale',
        },
        authority,
      ),
    ).rejects.toMatchObject({ code: 'LOCAL_BASELINE_DRIFT' });
  }, 30000);

  it('rejects a junction escape rather than reading its target', async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), 'local-outside-'));
    await writeFile(path.join(outside, 'private.txt'), 'outside');
    await symlink(outside, path.join(root, 'escape'), 'junction');
    const authority = await GitLocalSnapshotAuthority.open(root, 'demo');
    await expect(authority.capture('demo')).rejects.toMatchObject({
      code: 'LOCAL_PATH_LINK_REJECTED',
    });
    expect(await readFile(path.join(outside, 'private.txt'), 'utf8')).toBe('outside');
  });
});
