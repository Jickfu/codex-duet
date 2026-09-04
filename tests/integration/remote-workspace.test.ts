import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { GitLocalSnapshotAuthority } from '../../src/local/git-snapshot-authority.js';
import { LocalCodeProvider } from '../../src/local/local-code-provider.js';
import { LocalEvidenceStore } from '../../src/local/evidence-store.js';
import { openRemoteWorkspace } from '../../src/local/remote-workspace.js';

describe('remote grant over real Git snapshots', () => {
  it('keeps dirty captures private until formal publication and limits old reviews', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'duet-remote-'));
    const git = (args: string[]) => promisify(execFile)('git', args, { cwd: root });
    await git(['init']);
    await git(['config', 'user.email', 'fixture@example.invalid']);
    await git(['config', 'user.name', 'Fixture']);
    await writeFile(path.join(root, '.gitignore'), '.chatbridge/\n');
    await writeFile(path.join(root, 'hello.txt'), 'baseline\n');
    await git(['add', '.']);
    await git(['commit', '-m', 'fixture']);
    const authority = await GitLocalSnapshotAuthority.open(root, 'demo');
    const evidence = new LocalEvidenceStore(path.join(root, '.chatbridge'));
    const provider = new LocalCodeProvider(authority, evidence, path.join(root, '.chatbridge'));
    const baseline = await provider.prepareContext('demo');
    const remote = await openRemoteWorkspace(root, 'demo');
    expect(await remote.authorizeSnapshot(baseline.baselineSnapshotId)).toBe(true);
    const published: string[] = [];
    for (let iteration = 1; iteration <= 3; iteration++) {
      await writeFile(path.join(root, 'hello.txt'), `iteration ${iteration}\n`);
      const captured = await authority.capture('demo');
      expect(await remote.authorizeSnapshot(captured.snapshotId)).toBe(false);
      await evidence.record(
        {
          version: 1,
          taskId: 'demo',
          snapshotId: captured.snapshotId,
          iteration,
          status: 'PASS',
          summary: 'fixture assertion',
          recordedAt: new Date().toISOString(),
        },
        {
          version: 1,
          taskId: 'demo',
          snapshotId: captured.snapshotId,
          iteration,
          summary: 'fixture edit',
        },
        authority,
      );
      expect(await remote.authorizeSnapshot(captured.snapshotId, iteration)).toBe(false);
      await provider.prepareReview({ taskId: 'demo', iteration });
      expect(await remote.authorizeSnapshot(captured.snapshotId)).toBe(true);
      expect(await remote.authorizeSnapshot(captured.snapshotId, iteration)).toBe(true);
      published.push(captured.snapshotId);
    }
    expect(await remote.authorizeSnapshot(published[0]!)).toBe(false);
    expect(await remote.authorizeSnapshot(published[0]!, 1)).toBe(false);
    expect(await remote.authorizeSnapshot(published[2]!, 4)).toBe(false);
    expect(await remote.authorizeSnapshot(published[1]!)).toBe(true);
    expect(await remote.authorizeSnapshot(baseline.baselineSnapshotId)).toBe(true);
    await writeFile(path.join(root, 'hello.txt'), 'live secret not published');
    const stored = await remote.workspace.readFile({
      taskId: 'demo',
      snapshotId: published[2]!,
      path: 'hello.txt',
    });
    expect(Buffer.from(stored.content, 'base64').toString()).toBe('iteration 3\n');
    await expect(openRemoteWorkspace(root, 'unknown')).rejects.toThrow('LOCAL task was not found');
    expect((await git(['status', '--porcelain'])).stdout).toContain('hello.txt');
  }, 30_000);
});
