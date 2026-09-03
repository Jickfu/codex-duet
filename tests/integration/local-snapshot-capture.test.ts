import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  unlink,
  symlink,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitLocalSnapshotAuthority } from '../../src/local/git-snapshot-authority.js';
import { LocalWorkspaceService } from '../../src/local/workspace-service.js';
import { LocalEvidenceStore } from '../../src/local/evidence-store.js';
import { LocalCodeProvider } from '../../src/local/local-code-provider.js';

const execute = promisify(execFile);
afterEach(() => vi.unstubAllEnvs());
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
  it.each([false, true])(
    'never leaks sensitive descendants across file/directory replacement (reverse=%s)',
    async (reverse) => {
      if (reverse) {
        await mkdir(path.join(root, 'config'));
        await writeFile(path.join(root, 'config', '.env'), 'SECRET=must-not-leak\n');
        await git('add', '-f', 'config/.env');
      } else {
        await writeFile(path.join(root, 'config'), 'old configuration\n');
        await git('add', 'config');
      }
      await git('commit', '-m', 'replacement baseline');
      await git('rm', '-r', 'config');
      if (reverse) {
        await writeFile(path.join(root, 'config'), 'replacement\n');
        await git('add', 'config');
      } else {
        await mkdir(path.join(root, 'config'));
        await writeFile(path.join(root, 'config', '.env'), 'SECRET=must-not-leak\n');
        await git('add', '-f', 'config/.env');
      }
      const authority = await GitLocalSnapshotAuthority.open(root, 'demo');
      const snapshot = await authority.capture('demo');
      const manifest = await authority.store.read('demo', snapshot.snapshotId);
      const artifact = JSON.parse(
        (await authority.store.readBlob(manifest.gitDiffBlobSha256)).toString(),
      );
      const patch = Buffer.from(artifact.contentBase64, 'base64').toString();
      expect(patch).toContain('config');
      expect(patch).not.toContain('.env');
      expect(patch).not.toContain('must-not-leak');
      expect(artifact.paths).not.toContain('config/.env');
    },
    30000,
  );

  it.each(['info', 'global', 'ignored-workspace'])(
    'binds changed %s ignore policy before any newly hidden source exists',
    async (kind) => {
      let file = path.join(root, '.git', 'info', 'exclude');
      if (kind === 'global') {
        file = path.join(await mkdtemp(path.join(os.tmpdir(), 'global-ignore-')), 'rules');
        await writeFile(file, '');
        await git('config', 'core.excludesFile', file);
      } else if (kind === 'ignored-workspace') {
        await writeFile(path.join(root, '.gitignore'), 'nested/.gitignore\n');
        await mkdir(path.join(root, 'nested'));
        file = path.join(root, 'nested', '.gitignore');
        await writeFile(file, '');
      }
      const authority = await GitLocalSnapshotAuthority.open(root, 'demo');
      const baseline = await authority.capture('demo');
      await writeFile(file, 'hidden.txt\n');
      await expect(authority.assertLiveSnapshot(baseline.snapshotId)).rejects.toMatchObject({
        code: 'LOCAL_BASELINE_DRIFT',
      });
    },
    30000,
  );

  it('ignores alternate Git environment repository and index selection', async () => {
    const authority = await GitLocalSnapshotAuthority.open(root, 'demo');
    const expected = await authority.capture('demo');
    const alternate = path.join(await mkdtemp(path.join(os.tmpdir(), 'alternate-index-')), 'index');
    await copyFile(path.join(root, '.git', 'index'), alternate);
    await execute('git', ['update-index', '--force-remove', 'tracked.txt'], {
      cwd: root,
      env: { ...process.env, GIT_INDEX_FILE: alternate },
    });
    vi.stubEnv('GIT_INDEX_FILE', alternate);
    vi.stubEnv('GIT_DIR', path.join(root, 'nonexistent-git'));
    vi.stubEnv('GIT_CONFIG_COUNT', '1');
    vi.stubEnv('GIT_CONFIG_KEY_0', 'core.worktree');
    vi.stubEnv('GIT_CONFIG_VALUE_0', '/invalid');
    expect(
      (await (await GitLocalSnapshotAuthority.open(root, 'demo')).capture('demo')).snapshotId,
    ).toBe(expected.snapshotId);
  }, 30000);

  it.each(['--skip-worktree', '--assume-unchanged'])(
    'rejects index semantic flag %s',
    async (flag) => {
      await git('update-index', flag, 'tracked.txt');
      const authority = await GitLocalSnapshotAuthority.open(root, 'demo');
      await expect(authority.capture('demo')).rejects.toMatchObject({
        code: 'LOCAL_INDEX_UNSUPPORTED',
      });
    },
  );

  it.each(['120000', '160000'])(
    'rejects unsupported mode %s even at a sensitive path',
    async (mode) => {
      const hash = (
        await git('rev-parse', mode === '160000' ? 'HEAD' : 'HEAD:tracked.txt')
      ).stdout.trim();
      await git('update-index', '--add', '--cacheinfo', `${mode},${hash},.env`);
      const authority = await GitLocalSnapshotAuthority.open(root, 'demo');
      await expect(authority.capture('demo')).rejects.toMatchObject({
        code: 'LOCAL_INDEX_UNSUPPORTED',
      });
    },
  );

  it('rejects conflict stages at an excluded sensitive path', async () => {
    const hash = (await git('rev-parse', 'HEAD:tracked.txt')).stdout.trim();
    await new Promise<void>((resolve, reject) => {
      const child = execFile('git', ['update-index', '--index-info'], { cwd: root }, (error) => {
        if (error) reject(error);
        else resolve();
      });
      child.stdin!.end(`100644 ${hash} 1\t.env\n100644 ${hash} 2\t.env\n`);
    });
    const authority = await GitLocalSnapshotAuthority.open(root, 'demo');
    await expect(authority.capture('demo')).rejects.toMatchObject({
      code: 'LOCAL_INDEX_UNSUPPORTED',
    });
  });

  it('includes staged deletion, rename delete-half, and text/binary untracked additions', async () => {
    await writeFile(path.join(root, 'rename.txt'), 'rename content\n');
    await git('add', 'rename.txt');
    await git('commit', '-m', 'rename baseline');
    await git('rm', 'tracked.txt');
    await git('mv', 'rename.txt', 'renamed.txt');
    await writeFile(path.join(root, 'new.txt'), 'untracked text\n');
    await writeFile(path.join(root, 'new.bin'), Buffer.from([0, 255, 1, 2, 0]));
    const authority = await GitLocalSnapshotAuthority.open(root, 'demo');
    const snapshot = await authority.capture('demo');
    const diff = await new LocalWorkspaceService(authority.store).gitDiff({
      taskId: 'demo',
      snapshotId: snapshot.snapshotId,
    });
    const text = Buffer.from(diff.content, 'base64').toString();
    expect(text).toContain('a/tracked.txt');
    expect(text).toContain('a/rename.txt');
    expect(text.match(/deleted file mode/g)).toHaveLength(2);
    expect(text).toContain('+untracked text');
    expect(text).toContain('GIT binary patch');
    expect(text).toContain('new file mode 100644');
  }, 30000);

  it.skipIf(process.platform === 'win32')(
    'binds untracked executable mode to snapshot identity',
    async () => {
      const file = path.join(root, 'new-script.sh');
      await writeFile(file, '#!/bin/sh\nexit 0\n');
      await chmod(file, 0o644);
      const authority = await GitLocalSnapshotAuthority.open(root, 'demo');
      const before = await authority.capture('demo');
      await chmod(file, 0o755);
      await expect(authority.assertLiveSnapshot(before.snapshotId)).rejects.toMatchObject({
        code: 'LOCAL_BASELINE_DRIFT',
      });
    },
  );

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
