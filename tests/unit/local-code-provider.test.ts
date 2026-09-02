import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  localWorkspaceSnapshotFingerprint,
  type LocalWorkspaceSnapshotWithoutId,
} from '../../src/local/domain.js';
import {
  LocalCodeProvider,
  type LocalSnapshotAuthority,
} from '../../src/local/local-code-provider.js';

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

function snapshot(marker: string) {
  const digest = marker.repeat(64).slice(0, 64);
  const content: LocalWorkspaceSnapshotWithoutId = {
    version: 1,
    kind: 'LOCAL_WORKSPACE_SNAPSHOT',
    workspaceId: 'a'.repeat(64),
    git: {
      head: 'b'.repeat(40),
      branch: 'main',
      detached: false,
      indexManifestSha256: digest,
      statusSha256: digest,
    },
    surface: { policyVersion: 1, manifestSha256: digest, fileCount: 0, totalBytes: 0 },
    artifacts: { gitStatusSha256: digest, gitDiffSha256: digest },
  };
  return { ...content, snapshotId: localWorkspaceSnapshotFingerprint(content) };
}

describe('LOCAL provider checkpoint and drift authority', () => {
  it('persists a baseline and a sequential multi-round review chain', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'local-provider-'));
    roots.push(root);
    const captured = [snapshot('c'), snapshot('d'), snapshot('e')];
    const asserted: string[] = [];
    const authority: LocalSnapshotAuthority = {
      async capture() {
        return captured.shift()!;
      },
      async assertLiveSnapshot(value) {
        asserted.push(value);
      },
    };
    const provider = new LocalCodeProvider(authority, root);
    const context = await provider.prepareContext('demo');
    expect(context.baselineSnapshotId).toBe(snapshot('c').snapshotId);
    const first = await provider.prepareReview({
      taskId: 'demo',
      iteration: 1,
      testStatus: 'PASS',
      testEvidenceSha256: 'f'.repeat(64),
      executionSummarySha256: '1'.repeat(64),
    });
    expect(first.previousReviewSnapshotId).toBeUndefined();
    const second = await provider.prepareReview({
      taskId: 'demo',
      iteration: 2,
      testStatus: 'PASS',
      testEvidenceSha256: '2'.repeat(64),
      executionSummarySha256: '3'.repeat(64),
    });
    expect(second.previousReviewSnapshotId).toBe(first.reviewSnapshotId);
    expect(asserted).toEqual([context.baselineSnapshotId, first.reviewSnapshotId]);
    const resumed = new LocalCodeProvider(authority, root);
    await expect(resumed.prepareContext('demo')).resolves.toEqual(context);
    expect(asserted.at(-1)).toBe(second.reviewSnapshotId);
  });

  it('fails before capture on drift and rejects non-sequential review', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'local-provider-drift-'));
    roots.push(root);
    let captures = 0;
    const authority: LocalSnapshotAuthority = {
      async capture() {
        captures += 1;
        return snapshot('c');
      },
      async assertLiveSnapshot() {
        throw Object.assign(new Error('drift'), { code: 'LOCAL_BASELINE_DRIFT' });
      },
    };
    const provider = new LocalCodeProvider(authority, root);
    await provider.prepareContext('demo');
    await expect(
      provider.prepareReview({
        taskId: 'demo',
        iteration: 2,
        testStatus: 'PASS',
        testEvidenceSha256: 'f'.repeat(64),
        executionSummarySha256: '1'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'LOCAL_ITERATION_MISMATCH' });
    await expect(
      provider.prepareReview({
        taskId: 'demo',
        iteration: 1,
        testStatus: 'PASS',
        testEvidenceSha256: 'f'.repeat(64),
        executionSummarySha256: '1'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'LOCAL_BASELINE_DRIFT' });
    expect(captures).toBe(1);
  });
});
