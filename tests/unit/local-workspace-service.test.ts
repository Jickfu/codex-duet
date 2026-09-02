import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  localWorkspaceSnapshotFingerprint,
  type LocalWorkspaceSnapshotWithoutId,
} from '../../src/local/domain.js';
import {
  LocalSnapshotStore,
  localSnapshotSurfaceManifestFingerprint,
  type LocalSnapshotManifestV1,
} from '../../src/local/snapshot-store.js';
import {
  LocalWorkspaceService,
  serializeLocalGitArtifact,
} from '../../src/local/workspace-service.js';
import { createLocalReadTools, LOCAL_READ_TOOL_NAMES } from '../../src/local/read-tools.js';

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workspace-service-'));
  roots.push(root);
  const store = new LocalSnapshotStore(path.join(root, '.chatbridge'));
  const status = await store.putBlob(
    serializeLocalGitArtifact({
      version: 1,
      kind: 'STATUS',
      paths: ['src/a.txt'],
      contentBase64: Buffer.from(' M src/a.txt\n').toString('base64'),
    }),
  );
  const diff = await store.putBlob(
    serializeLocalGitArtifact({
      version: 1,
      kind: 'DIFF',
      paths: ['src/a.txt'],
      contentBase64: Buffer.from('diff --git a/src/a.txt b/src/a.txt\n').toString('base64'),
    }),
  );
  const a = await store.putBlob(Buffer.from('alpha\nneedle one\n'));
  const b = await store.putBlob(Buffer.from('needle two\n'));
  const entries = [
    { path: 'README.md', blobSha256: b, bytes: 11 },
    { path: 'src/a.txt', blobSha256: a, bytes: 17 },
  ];
  const content: LocalWorkspaceSnapshotWithoutId = {
    version: 1,
    kind: 'LOCAL_WORKSPACE_SNAPSHOT',
    workspaceId: 'a'.repeat(64),
    git: {
      head: 'b'.repeat(40),
      branch: 'main',
      detached: false,
      indexManifestSha256: status,
      statusSha256: status,
    },
    surface: {
      policyVersion: 1,
      manifestSha256: localSnapshotSurfaceManifestFingerprint(entries),
      fileCount: 2,
      totalBytes: 28,
    },
    artifacts: { gitStatusSha256: status, gitDiffSha256: diff },
  };
  const snapshot = { ...content, snapshotId: localWorkspaceSnapshotFingerprint(content) };
  const manifest: LocalSnapshotManifestV1 = {
    version: 1,
    taskId: 'demo',
    snapshot,
    entries,
    gitStatusBlobSha256: status,
    gitDiffBlobSha256: diff,
  };
  await store.publish(manifest);
  return { store, snapshot, manifest };
}

describe('snapshot-bound LOCAL workspace service', () => {
  it('exposes exactly eight read-only, explicitly snapshot-bound tools', async () => {
    const { store, snapshot } = await fixture();
    const tools = createLocalReadTools(new LocalWorkspaceService(store));
    expect(Object.keys(tools)).toEqual(LOCAL_READ_TOOL_NAMES);
    await expect(
      tools.workspace_info.invoke({ taskId: 'demo', snapshotId: snapshot.snapshotId }),
    ).resolves.toMatchObject({ taskId: 'demo' });
    await expect(tools.workspace_info.invoke({ taskId: 'demo' })).rejects.toThrow();
    expect(Object.keys(tools)).not.toContain('write_file');
  });

  it('serves all workspace reads from one explicit immutable snapshot', async () => {
    const { store, snapshot } = await fixture();
    const service = new LocalWorkspaceService(store);
    const bound = { taskId: 'demo', snapshotId: snapshot.snapshotId };
    await expect(service.workspaceInfo(bound)).resolves.toMatchObject({ taskId: 'demo', snapshot });
    await expect(service.listDirectory(bound)).resolves.toMatchObject({
      entries: [
        { name: 'README.md', kind: 'FILE' },
        { name: 'src', kind: 'DIRECTORY' },
      ],
    });
    const read = await service.readFile({ ...bound, path: 'src/a.txt', offset: 6, length: 6 });
    expect(Buffer.from(read.content, 'base64').toString()).toBe('needle');
    await expect(service.searchWorkspace({ ...bound, query: 'needle' })).resolves.toMatchObject({
      results: [
        { path: 'README.md', line: 1 },
        { path: 'src/a.txt', line: 2 },
      ],
    });
    const status = await service.gitStatus(bound);
    expect(Buffer.from(status.content, 'base64').toString()).toBe(' M src/a.txt\n');
    const diff = await service.gitDiff(bound);
    expect(Buffer.from(diff.content, 'base64').toString()).toBe(
      'diff --git a/src/a.txt b/src/a.txt\n',
    );
  });

  it('fails closed on identity mismatch, sensitive paths, and evidence mismatch', async () => {
    const { store, snapshot, manifest } = await fixture();
    const bound = { taskId: 'demo', snapshotId: snapshot.snapshotId };
    const service = new LocalWorkspaceService(store, {
      async readTestEvidence() {
        return {
          version: 1,
          taskId: 'other',
          snapshotId: snapshot.snapshotId,
          iteration: 1,
          status: 'PASS',
          summary: 'ok',
          recordedAt: new Date(0).toISOString(),
        };
      },
      async readExecutionSummary() {
        return {
          version: 1,
          taskId: 'demo',
          snapshotId: snapshot.snapshotId,
          iteration: 1,
          summary: 'done',
        };
      },
    });
    await expect(service.workspaceInfo({ ...bound, taskId: 'other' })).rejects.toThrow();
    await expect(service.testStatus({ ...bound, iteration: 1 })).rejects.toMatchObject({
      code: 'LOCAL_EVIDENCE_IDENTITY_MISMATCH',
    });
    await expect(service.executionSummary({ ...bound, iteration: 2 })).rejects.toMatchObject({
      code: 'LOCAL_EVIDENCE_IDENTITY_MISMATCH',
    });
    await expect(service.executionSummary({ ...bound, iteration: 1 })).resolves.toMatchObject({
      summary: 'done',
    });

    const secretBytes = Buffer.from('secret');
    const secretSha = await store.putBlob(secretBytes);
    const entries = [{ path: 'nested/.env', blobSha256: secretSha, bytes: secretBytes.length }];
    const content = {
      ...manifest.snapshot,
      surface: {
        ...manifest.snapshot.surface,
        manifestSha256: localSnapshotSurfaceManifestFingerprint(entries),
        fileCount: 1,
        totalBytes: secretBytes.length,
      },
    };
    const withoutId = Object.fromEntries(
      Object.entries(content).filter(([key]) => key !== 'snapshotId'),
    ) as LocalWorkspaceSnapshotWithoutId;
    const secretSnapshot = {
      ...withoutId,
      snapshotId: localWorkspaceSnapshotFingerprint(withoutId),
    };
    await store.publish({ ...manifest, snapshot: secretSnapshot, entries });
    await expect(
      service.listDirectory({ taskId: 'demo', snapshotId: secretSnapshot.snapshotId }),
    ).rejects.toMatchObject({ code: 'LOCAL_SENSITIVE_PATH_UNREVIEWABLE' });

    const unsafeDiff = await store.putBlob(
      serializeLocalGitArtifact({
        version: 1,
        kind: 'DIFF',
        paths: ['.env'],
        contentBase64: Buffer.from('API_KEY=secret\n').toString('base64'),
      }),
    );
    const unsafeContent: LocalWorkspaceSnapshotWithoutId = {
      ...withoutId,
      surface: manifest.snapshot.surface,
      artifacts: { ...withoutId.artifacts, gitDiffSha256: unsafeDiff },
    };
    const unsafeSnapshot = {
      ...unsafeContent,
      snapshotId: localWorkspaceSnapshotFingerprint(unsafeContent),
    };
    await store.publish({
      ...manifest,
      snapshot: unsafeSnapshot,
      gitDiffBlobSha256: unsafeDiff,
    });
    await expect(
      service.gitDiff({ taskId: 'demo', snapshotId: unsafeSnapshot.snapshotId }),
    ).rejects.toMatchObject({ code: 'LOCAL_SENSITIVE_PATH_UNREVIEWABLE' });
    await expect(
      service.workspaceInfo({ taskId: 'demo', snapshotId: unsafeSnapshot.snapshotId }),
    ).rejects.toMatchObject({ code: 'LOCAL_SENSITIVE_PATH_UNREVIEWABLE' });
    await expect(
      service.executionSummary({
        taskId: 'demo',
        iteration: 1,
        snapshotId: unsafeSnapshot.snapshotId,
      }),
    ).rejects.toMatchObject({ code: 'LOCAL_SENSITIVE_PATH_UNREVIEWABLE' });
  });
});
