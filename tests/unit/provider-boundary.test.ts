import { describe, expect, expectTypeOf, it } from 'vitest';
import { TaskIdSchema, TestStatusSchema } from '../../src/core/domain.js';
import { githubReviewEnvelope } from '../../src/github/review-envelope.js';
import type {
  GitHubContextRef,
  GitHubReviewTarget,
  LocalContextRef,
} from '../../src/providers/code-provider.js';
import {
  localReviewTargetFingerprint,
  localWorkspaceSnapshotFingerprint,
  LocalContextRefSchema,
  validateLocalReviewTargetIntegrity,
  validateLocalWorkspaceSnapshotIntegrity,
  type LocalReviewTargetWithoutFingerprint,
  type LocalWorkspaceSnapshotWithoutId,
} from '../../src/local/domain.js';
import { GitHubCodeProvider } from '../../src/github/github-code-provider.js';

describe('provider boundary', () => {
  it('keeps task ID and test status independent of GitHub modules', () => {
    expect(TaskIdSchema.parse('shared_1')).toBe('shared_1');
    expect(TestStatusSchema.options).toEqual(['PASS', 'FAIL', 'NOT_RUN']);
  });

  it('models GitHub and Local contexts as discriminated types', () => {
    expectTypeOf<
      Awaited<ReturnType<GitHubCodeProvider['prepareContext']>>
    >().toEqualTypeOf<GitHubContextRef>();
    expectTypeOf<
      Awaited<ReturnType<GitHubCodeProvider['getReviewTarget']>>
    >().toEqualTypeOf<GitHubReviewTarget>();
    expectTypeOf<Parameters<typeof githubReviewEnvelope>[0]>().toEqualTypeOf<GitHubReviewTarget>();
    expectTypeOf<LocalContextRef>().not.toMatchTypeOf<Parameters<typeof githubReviewEnvelope>[0]>();
    const digest = 'a'.repeat(64);
    const local: LocalContextRef = {
      mode: 'LOCAL',
      taskId: 'local',
      workspaceId: digest,
      baselineSnapshotId: digest,
    };
    expect(local.mode).toBe('LOCAL');
    expect(LocalContextRefSchema.parse(local)).toEqual(local);
  });

  it('separates immutable workspace state from formal LOCAL review authority', () => {
    const digest = 'a'.repeat(64);
    const snapshotContent: LocalWorkspaceSnapshotWithoutId = {
      version: 1,
      kind: 'LOCAL_WORKSPACE_SNAPSHOT',
      workspaceId: digest,
      git: {
        head: 'b'.repeat(40),
        branch: 'main',
        detached: false,
        indexManifestSha256: digest,
        statusSha256: digest,
      },
      surface: {
        policyVersion: 1,
        manifestSha256: digest,
        fileCount: 10,
        totalBytes: 1000,
      },
      artifacts: { gitStatusSha256: digest, gitDiffSha256: digest },
    };
    const snapshot = validateLocalWorkspaceSnapshotIntegrity({
      ...snapshotContent,
      snapshotId: localWorkspaceSnapshotFingerprint(snapshotContent),
    });
    expect(snapshot.snapshotId).toBe(localWorkspaceSnapshotFingerprint(snapshotContent));

    const targetContent: LocalReviewTargetWithoutFingerprint = {
      version: 1,
      mode: 'LOCAL',
      taskId: 'local',
      iteration: 1,
      workspaceId: digest,
      baselineSnapshotId: digest,
      reviewSnapshotId: digest,
      testEvidenceSha256: digest,
      executionSummarySha256: digest,
      testStatus: 'PASS',
      changeAttribution: 'UNATTRIBUTED_NET_DELTA',
    };
    const target = validateLocalReviewTargetIntegrity({
      ...targetContent,
      reviewTargetSha256: localReviewTargetFingerprint(targetContent),
    });
    expect(target).not.toHaveProperty('reviewRef');
    expect(target.changeAttribution).toBe('UNATTRIBUTED_NET_DELTA');
  });

  it('freezes deterministic LOCAL authority fingerprints and rejects tampering', () => {
    const digest = 'a'.repeat(64);
    const snapshotContent: LocalWorkspaceSnapshotWithoutId = {
      version: 1,
      kind: 'LOCAL_WORKSPACE_SNAPSHOT',
      workspaceId: digest,
      git: {
        head: 'b'.repeat(40),
        detached: true,
        indexManifestSha256: digest,
        statusSha256: digest,
      },
      surface: { policyVersion: 1, manifestSha256: digest, fileCount: 1, totalBytes: 10 },
      artifacts: { gitStatusSha256: digest, gitDiffSha256: digest },
    };
    const reordered = JSON.parse(
      JSON.stringify(snapshotContent),
    ) as LocalWorkspaceSnapshotWithoutId;
    expect(localWorkspaceSnapshotFingerprint(reordered)).toBe(
      localWorkspaceSnapshotFingerprint(snapshotContent),
    );
    expect(
      localWorkspaceSnapshotFingerprint({
        ...snapshotContent,
        surface: { ...snapshotContent.surface, totalBytes: 11 },
      }),
    ).not.toBe(localWorkspaceSnapshotFingerprint(snapshotContent));
    expect(() =>
      validateLocalWorkspaceSnapshotIntegrity({ ...snapshotContent, snapshotId: digest }),
    ).toThrowError(expect.objectContaining({ code: 'LOCAL_SNAPSHOT_INTEGRITY_INVALID' }));

    const reviewContent: LocalReviewTargetWithoutFingerprint = {
      version: 1,
      mode: 'LOCAL',
      taskId: 'local',
      iteration: 1,
      workspaceId: digest,
      baselineSnapshotId: digest,
      reviewSnapshotId: digest,
      testEvidenceSha256: digest,
      executionSummarySha256: digest,
      testStatus: 'NOT_RUN',
      changeAttribution: 'UNATTRIBUTED_NET_DELTA',
    };
    expect(localReviewTargetFingerprint({ ...reviewContent, iteration: 2 })).not.toBe(
      localReviewTargetFingerprint(reviewContent),
    );
    expect(() =>
      validateLocalReviewTargetIntegrity({ ...reviewContent, reviewTargetSha256: digest }),
    ).toThrowError(expect.objectContaining({ code: 'LOCAL_REVIEW_TARGET_INTEGRITY_INVALID' }));
  });
});
