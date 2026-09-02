import { mkdtemp, mkdir, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from '../../src/duet/task-spec.js';
import {
  localWorkspaceSnapshotFingerprint,
  type LocalWorkspaceSnapshotWithoutId,
} from '../../src/local/domain.js';
import {
  resolveWorkspacePath,
  validateWorkspaceRelativePath,
} from '../../src/local/path-policy.js';
import { isSensitiveWorkspacePath } from '../../src/local/sensitive-policy.js';
import {
  localSnapshotSurfaceManifestFingerprint,
  LocalSnapshotStore,
  type LocalSnapshotManifestV1,
} from '../../src/local/snapshot-store.js';

const roots: string[] = [];

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe('LOCAL path and sensitive-file policy', () => {
  it('accepts only workspace-relative POSIX paths', () => {
    expect(validateWorkspaceRelativePath('src/foo.ts')).toBe('src/foo.ts');
    for (const invalid of [
      '../x',
      'a/../../b',
      '/x',
      'C:/x',
      '\\\\server\\x',
      'a\\b',
      'NUL',
      'NUL.',
      'NUL ',
      '.env.',
      '.git.',
      '.npmrc.',
      'x:ads',
    ])
      expect(() => validateWorkspaceRelativePath(invalid)).toThrow();
  });

  it('uses explicit credential payload patterns without denying ordinary source names', () => {
    for (const denied of [
      '.env',
      '.env.local',
      'certs/server.pem',
      '.ssh/id_ed25519',
      '.aws/credentials',
      '.azure/profile.json',
      '.config/gcloud/application_default_credentials.json',
      'infra/.aws/credentials',
      'tools/.azure/profile.json',
      'sandbox/.config/gcloud/access_tokens.db',
      'credentials.json',
      '.npmrc',
      '.git/config',
      '.chatbridge/run.json',
    ])
      expect(isSensitiveWorkspacePath(denied)).toBe(true);
    for (const allowed of ['src/SecretService.ts', 'src/token-parser.ts', 'PasswordValidator.java'])
      expect(isSensitiveWorkspacePath(allowed)).toBe(false);
  });

  it('never traverses symlinks', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'local-path-'));
    roots.push(root);
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src', 'ok.txt'), 'ok');
    await expect(resolveWorkspacePath(root, 'src/ok.txt')).resolves.toMatchObject({
      symlink: false,
    });
    await symlink(path.join(root, 'src'), path.join(root, 'link'), 'junction');
    await expect(resolveWorkspacePath(root, 'link/ok.txt')).rejects.toMatchObject({
      code: 'LOCAL_PATH_LINK_REJECTED',
    });
  });
});

describe('LOCAL immutable snapshot store', () => {
  it('deduplicates verified blobs and atomically freezes one manifest identity', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'local-store-'));
    roots.push(root);
    const store = new LocalSnapshotStore(path.join(root, '.chatbridge'));
    const fileBytes = Buffer.from('hello');
    const emptyBytes = Buffer.alloc(0);
    const fileSha = await store.putBlob(fileBytes);
    const emptySha = await store.putBlob(emptyBytes);
    expect(await store.putBlob(fileBytes)).toBe(fileSha);
    expect(await store.readBlob(fileSha)).toEqual(fileBytes);

    const entries = [{ path: 'src/a.txt', blobSha256: fileSha, bytes: fileBytes.length }];
    const snapshotContent: LocalWorkspaceSnapshotWithoutId = {
      version: 1,
      kind: 'LOCAL_WORKSPACE_SNAPSHOT',
      workspaceId: 'a'.repeat(64),
      git: {
        head: 'b'.repeat(40),
        branch: 'main',
        detached: false,
        indexManifestSha256: emptySha,
        statusSha256: emptySha,
      },
      surface: {
        policyVersion: 1,
        manifestSha256: localSnapshotSurfaceManifestFingerprint(entries),
        fileCount: 1,
        totalBytes: fileBytes.length,
      },
      artifacts: { gitStatusSha256: emptySha, gitDiffSha256: emptySha },
    };
    const snapshot = {
      ...snapshotContent,
      snapshotId: localWorkspaceSnapshotFingerprint(snapshotContent),
    };
    const manifest: LocalSnapshotManifestV1 = {
      version: 1,
      taskId: 'demo',
      snapshot,
      entries,
      gitStatusBlobSha256: emptySha,
      gitDiffBlobSha256: emptySha,
    };
    await store.publish(manifest);
    await expect(store.publish(manifest)).resolves.toBeUndefined();
    expect(await store.read('demo', snapshot.snapshotId)).toEqual(manifest);

    const snapshotFile = path.join(
      root,
      '.chatbridge',
      'runs',
      'demo',
      'local',
      'snapshots',
      `${snapshot.snapshotId}.json`,
    );
    const corrupted = {
      ...manifest,
      entries: [{ ...entries[0]!, path: 'src/changed.txt' }],
    };
    await writeFile(snapshotFile, `${canonicalJson(corrupted)}\n`);
    await expect(store.read('demo', snapshot.snapshotId)).rejects.toMatchObject({
      code: 'LOCAL_MANIFEST_INTEGRITY_INVALID',
    });

    const blobDirectory = path.join(root, '.chatbridge', 'local', 'blobs', fileSha.slice(0, 2));
    expect((await readdir(blobDirectory)).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('rejects duplicate entries and inconsistent surface totals', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'local-manifest-'));
    roots.push(root);
    const store = new LocalSnapshotStore(path.join(root, '.chatbridge'));
    const blobSha = await store.putBlob(Buffer.from('x'));
    const entries = [
      { path: 'a.txt', blobSha256: blobSha, bytes: 1 },
      { path: 'a.txt', blobSha256: blobSha, bytes: 1 },
    ];
    const snapshotContent: LocalWorkspaceSnapshotWithoutId = {
      version: 1,
      kind: 'LOCAL_WORKSPACE_SNAPSHOT',
      workspaceId: 'a'.repeat(64),
      git: {
        head: 'b'.repeat(40),
        detached: true,
        indexManifestSha256: blobSha,
        statusSha256: blobSha,
      },
      surface: {
        policyVersion: 1,
        manifestSha256: localSnapshotSurfaceManifestFingerprint(entries),
        fileCount: 1,
        totalBytes: 99,
      },
      artifacts: { gitStatusSha256: blobSha, gitDiffSha256: blobSha },
    };
    const snapshot = {
      ...snapshotContent,
      snapshotId: localWorkspaceSnapshotFingerprint(snapshotContent),
    };
    await expect(
      store.publish({
        version: 1,
        taskId: 'bad',
        snapshot,
        entries,
        gitStatusBlobSha256: blobSha,
        gitDiffBlobSha256: blobSha,
      }),
    ).rejects.toMatchObject({ code: 'LOCAL_MANIFEST_INVALID' });
  });
});
