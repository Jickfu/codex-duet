import { describe, expect, expectTypeOf, it } from 'vitest';
import { TaskIdSchema, TestStatusSchema } from '../../src/core/domain.js';
import { githubReviewEnvelope } from '../../src/github/review-envelope.js';
import type {
  GitHubContextRef,
  GitHubReviewTarget,
  LocalContextRef,
} from '../../src/providers/code-provider.js';
import {
  LocalContextRefSchema,
  LocalReviewTargetV1Schema,
  LocalWorkspaceSnapshotV1Schema,
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
    const snapshot = LocalWorkspaceSnapshotV1Schema.parse({
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
      snapshotId: digest,
    });
    expect(snapshot.snapshotId).toBe(digest);

    const target = LocalReviewTargetV1Schema.parse({
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
      reviewTargetSha256: digest,
    });
    expect(target).not.toHaveProperty('reviewRef');
    expect(target.changeAttribution).toBe('UNATTRIBUTED_NET_DELTA');
  });
});
