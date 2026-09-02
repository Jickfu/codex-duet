import { z } from 'zod';
import { TaskIdSchema, TestStatusSchema } from '../core/domain.js';
import { ChatbridgeError } from '../core/errors.js';
import { canonicalJson, sha256 } from '../duet/task-spec.js';

export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'Expected lowercase SHA-256');
export const WorkspaceIdSchema = z.string().regex(/^[0-9a-f]{64}$/, 'Invalid workspace ID');
export const SnapshotIdSchema = Sha256Schema;
export const ReviewTargetSha256Schema = Sha256Schema;

export const LocalWorkspaceSnapshotV1Schema = z
  .object({
    version: z.literal(1),
    kind: z.literal('LOCAL_WORKSPACE_SNAPSHOT'),
    workspaceId: WorkspaceIdSchema,
    git: z
      .object({
        head: z.string().regex(/^[0-9a-f]{40}$/, 'Expected full Git SHA'),
        branch: z.string().min(1).optional(),
        detached: z.boolean(),
        indexManifestSha256: Sha256Schema,
        statusSha256: Sha256Schema,
      })
      .strict(),
    surface: z
      .object({
        policyVersion: z.literal(1),
        manifestSha256: Sha256Schema,
        fileCount: z.number().int().nonnegative(),
        totalBytes: z.number().int().nonnegative(),
      })
      .strict(),
    artifacts: z
      .object({
        gitStatusSha256: Sha256Schema,
        gitDiffSha256: Sha256Schema,
      })
      .strict(),
    snapshotId: SnapshotIdSchema,
  })
  .strict();
export type LocalWorkspaceSnapshotV1 = z.infer<typeof LocalWorkspaceSnapshotV1Schema>;
export type LocalWorkspaceSnapshotWithoutId = Omit<LocalWorkspaceSnapshotV1, 'snapshotId'>;

export const LocalReviewTargetV1Schema = z
  .object({
    version: z.literal(1),
    mode: z.literal('LOCAL'),
    taskId: TaskIdSchema,
    iteration: z.number().int().positive(),
    workspaceId: WorkspaceIdSchema,
    baselineSnapshotId: SnapshotIdSchema,
    reviewSnapshotId: SnapshotIdSchema,
    previousReviewSnapshotId: SnapshotIdSchema.optional(),
    testEvidenceSha256: Sha256Schema,
    executionSummarySha256: Sha256Schema,
    testStatus: TestStatusSchema,
    changeAttribution: z.literal('UNATTRIBUTED_NET_DELTA'),
    reviewTargetSha256: ReviewTargetSha256Schema,
  })
  .strict();
export type LocalReviewTargetV1 = z.infer<typeof LocalReviewTargetV1Schema>;
export type LocalReviewTargetWithoutFingerprint = Omit<LocalReviewTargetV1, 'reviewTargetSha256'>;

export const LocalContextRefSchema = z
  .object({
    mode: z.literal('LOCAL'),
    taskId: TaskIdSchema,
    workspaceId: WorkspaceIdSchema,
    baselineSnapshotId: SnapshotIdSchema,
  })
  .strict();
export type LocalContextRef = z.infer<typeof LocalContextRefSchema>;

export function localWorkspaceSnapshotFingerprint(value: LocalWorkspaceSnapshotWithoutId): string {
  return sha256(canonicalJson(value));
}

export function validateLocalWorkspaceSnapshotIntegrity(value: unknown): LocalWorkspaceSnapshotV1 {
  const snapshot = LocalWorkspaceSnapshotV1Schema.parse(value);
  const content = Object.fromEntries(
    Object.entries(snapshot).filter(([key]) => key !== 'snapshotId'),
  ) as LocalWorkspaceSnapshotWithoutId;
  if (snapshot.snapshotId !== localWorkspaceSnapshotFingerprint(content))
    throw new ChatbridgeError(
      'LOCAL workspace snapshot fingerprint is invalid',
      'LOCAL_SNAPSHOT_INTEGRITY_INVALID',
    );
  return snapshot;
}

export function localReviewTargetFingerprint(value: LocalReviewTargetWithoutFingerprint): string {
  return sha256(canonicalJson(value));
}

export function validateLocalReviewTargetIntegrity(value: unknown): LocalReviewTargetV1 {
  const target = LocalReviewTargetV1Schema.parse(value);
  const content = Object.fromEntries(
    Object.entries(target).filter(([key]) => key !== 'reviewTargetSha256'),
  ) as LocalReviewTargetWithoutFingerprint;
  if (target.reviewTargetSha256 !== localReviewTargetFingerprint(content))
    throw new ChatbridgeError(
      'LOCAL review target fingerprint is invalid',
      'LOCAL_REVIEW_TARGET_INTEGRITY_INVALID',
    );
  return target;
}
