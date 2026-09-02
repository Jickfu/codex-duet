import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  localWorkspaceSnapshotFingerprint,
  type LocalWorkspaceSnapshotWithoutId,
} from '../../src/local/domain.js';
import {
  LocalCodeProvider,
  type LocalReviewEvidenceAuthority,
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
  const evidence: LocalReviewEvidenceAuthority = {
    async readTestEvidence(taskId, iteration, snapshotId) {
      return {
        version: 1,
        taskId,
        iteration,
        snapshotId,
        status: 'PASS',
        summary: 'pass',
        recordedAt: new Date(0).toISOString(),
      };
    },
    async readExecutionSummary(taskId, iteration, snapshotId) {
      return { version: 1, taskId, iteration, snapshotId, summary: 'done' };
    },
  };

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
    const provider = new LocalCodeProvider(authority, evidence, root);
    const context = await provider.prepareContext('demo');
    expect(context.baselineSnapshotId).toBe(snapshot('c').snapshotId);
    const first = await provider.prepareReview({ taskId: 'demo', iteration: 1 });
    expect(first.previousReviewSnapshotId).toBeUndefined();
    const second = await provider.prepareReview({ taskId: 'demo', iteration: 2 });
    expect(second.previousReviewSnapshotId).toBe(first.reviewSnapshotId);
    await expect(provider.prepareReview({ taskId: 'demo', iteration: 2 })).resolves.toEqual(second);
    expect(captured).toHaveLength(0);
    await expect(provider.prepareReview({ taskId: 'demo', iteration: 1 })).rejects.toMatchObject({
      code: 'LOCAL_REVIEW_STALE',
    });
    expect(asserted).toEqual([]);
    const resumed = new LocalCodeProvider(authority, evidence, root);
    await expect(resumed.prepareContext('demo')).resolves.toEqual(context);
    expect(asserted.at(-1)).toBe(second.reviewSnapshotId);
  });

  it('rejects invalid captured and persisted authority fingerprints', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'local-provider-integrity-'));
    roots.push(root);
    const invalid = { ...snapshot('c'), snapshotId: 'f'.repeat(64) };
    const badCapture = new LocalCodeProvider(
      {
        async capture() {
          return invalid;
        },
        async assertLiveSnapshot() {},
      },
      evidence,
      root,
    );
    await expect(badCapture.prepareContext('bad')).rejects.toMatchObject({
      code: 'LOCAL_SNAPSHOT_INTEGRITY_INVALID',
    });

    const captured = [snapshot('c'), snapshot('d')];
    const provider = new LocalCodeProvider(
      {
        async capture() {
          return captured.shift()!;
        },
        async assertLiveSnapshot() {},
      },
      evidence,
      root,
    );
    await provider.prepareContext('demo');
    await provider.prepareReview({ taskId: 'demo', iteration: 1 });
    const file = path.join(root, 'runs', 'demo', 'local', 'provider.json');
    const checkpoint = JSON.parse(await readFile(file, 'utf8'));
    checkpoint.reviews[0].reviewTarget.reviewTargetSha256 = '0'.repeat(64);
    await writeFile(file, JSON.stringify(checkpoint));
    await expect(provider.status('demo')).rejects.toMatchObject({
      code: 'LOCAL_REVIEW_TARGET_INTEGRITY_INVALID',
    });
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
    const provider = new LocalCodeProvider(authority, evidence, root);
    await provider.prepareContext('demo');
    await expect(provider.prepareReview({ taskId: 'demo', iteration: 2 })).rejects.toMatchObject({
      code: 'LOCAL_ITERATION_MISMATCH',
    });
    await expect(provider.assertReadyForIteration('demo')).rejects.toMatchObject({
      code: 'LOCAL_BASELINE_DRIFT',
    });
    await expect(provider.prepareReview({ taskId: 'demo', iteration: 1 })).resolves.toBeDefined();
    expect(captures).toBe(2);
  });
});
