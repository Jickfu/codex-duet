import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { TaskIdSchema } from '../core/domain.js';
import { ChatbridgeError } from '../core/errors.js';
import { canonicalJson, sha256 } from '../duet/task-spec.js';
import type { LocalReviewProvider } from '../providers/code-provider.js';
import {
  LocalContextRefSchema,
  LocalReviewTargetV1Schema,
  Sha256Schema,
  localReviewTargetFingerprint,
  validateLocalReviewTargetIntegrity,
  validateLocalWorkspaceSnapshotIntegrity,
  type LocalContextRef,
  type LocalReviewTargetV1,
  type LocalWorkspaceSnapshotV1,
} from './domain.js';
import {
  LocalExecutionSummaryV1Schema,
  LocalTestEvidenceV1Schema,
  type LocalExecutionSummaryV1,
  type LocalTestEvidenceV1,
} from './workspace-service.js';

const LocalIterationCheckpointSchema = z
  .object({
    iteration: z.number().int().positive(),
    reviewSnapshotId: Sha256Schema,
    reviewTarget: LocalReviewTargetV1Schema,
  })
  .strict();

export const LocalProviderCheckpointV1Schema = z
  .object({
    version: z.literal(1),
    mode: z.literal('LOCAL'),
    taskId: TaskIdSchema,
    context: LocalContextRefSchema,
    reviews: z.array(LocalIterationCheckpointSchema),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((value, refinement) => {
    if (value.context.taskId !== value.taskId)
      refinement.addIssue({ code: 'custom', path: ['context'], message: 'task mismatch' });
    value.reviews.forEach((review, index) => {
      if (
        review.iteration !== index + 1 ||
        review.reviewTarget.taskId !== value.taskId ||
        review.reviewTarget.iteration !== review.iteration ||
        review.reviewTarget.workspaceId !== value.context.workspaceId ||
        review.reviewTarget.baselineSnapshotId !== value.context.baselineSnapshotId ||
        review.reviewTarget.reviewSnapshotId !== review.reviewSnapshotId ||
        review.reviewTarget.previousReviewSnapshotId !==
          (index === 0 ? undefined : value.reviews[index - 1]?.reviewSnapshotId)
      )
        refinement.addIssue({
          code: 'custom',
          path: ['reviews', index],
          message: 'review chain identity mismatch',
        });
    });
  });
export type LocalProviderCheckpointV1 = z.infer<typeof LocalProviderCheckpointV1Schema>;

export interface LocalSnapshotAuthority {
  capture(taskId: string): Promise<LocalWorkspaceSnapshotV1>;
  assertLiveSnapshot(snapshotId: string): Promise<void>;
}

export interface LocalReviewEvidenceAuthority {
  readTestEvidence(taskId: string, iteration: number, snapshotId: string): Promise<unknown>;
  readExecutionSummary(taskId: string, iteration: number, snapshotId: string): Promise<unknown>;
}

export class LocalCodeProvider implements LocalReviewProvider {
  readonly mode = 'LOCAL' as const;
  private readonly store: LocalProviderCheckpointStore;

  constructor(
    private readonly snapshots: LocalSnapshotAuthority,
    private readonly evidence: LocalReviewEvidenceAuthority,
    stateRoot: string,
  ) {
    this.store = new LocalProviderCheckpointStore(stateRoot);
  }

  async prepareContext(taskIdInput: string): Promise<LocalContextRef> {
    const taskId = TaskIdSchema.parse(taskIdInput);
    const existing = await this.store.read(taskId);
    if (existing) {
      await this.snapshots.assertLiveSnapshot(this.expectedLiveSnapshot(existing));
      return existing.context;
    }
    const baseline = validateLocalWorkspaceSnapshotIntegrity(await this.snapshots.capture(taskId));
    const context = LocalContextRefSchema.parse({
      mode: 'LOCAL',
      taskId,
      workspaceId: baseline.workspaceId,
      baselineSnapshotId: baseline.snapshotId,
    });
    const now = new Date().toISOString();
    await this.store.write({
      version: 1,
      mode: 'LOCAL',
      taskId,
      context,
      reviews: [],
      createdAt: now,
      updatedAt: now,
    });
    return context;
  }

  async assertReadyForIteration(taskIdInput: string): Promise<void> {
    const checkpoint = await this.requireCheckpoint(taskIdInput);
    await this.snapshots.assertLiveSnapshot(this.expectedLiveSnapshot(checkpoint));
  }

  async prepareReview(input: { taskId: string; iteration: number }): Promise<LocalReviewTargetV1> {
    const taskId = TaskIdSchema.parse(input.taskId);
    const checkpoint = await this.requireCheckpoint(taskId);
    const iteration = z.number().int().positive().parse(input.iteration);
    if (iteration === checkpoint.reviews.length && checkpoint.reviews.length > 0)
      return this.recoverReview(checkpoint, iteration);
    if (iteration < checkpoint.reviews.length)
      throw new ChatbridgeError('LOCAL review iteration is stale', 'LOCAL_REVIEW_STALE');
    if (iteration !== checkpoint.reviews.length + 1)
      throw new ChatbridgeError(
        'LOCAL review iteration is not sequential',
        'LOCAL_ITERATION_MISMATCH',
      );
    const review = validateLocalWorkspaceSnapshotIntegrity(await this.snapshots.capture(taskId));
    if (review.workspaceId !== checkpoint.context.workspaceId)
      throw new ChatbridgeError(
        'LOCAL workspace identity changed',
        'LOCAL_WORKSPACE_IDENTITY_MISMATCH',
      );
    const previous = checkpoint.reviews.at(-1)?.reviewSnapshotId;
    const [testEvidence, executionSummary] = await Promise.all([
      this.readTestEvidence(taskId, iteration, review.snapshotId),
      this.readExecutionSummary(taskId, iteration, review.snapshotId),
    ]);
    const content = {
      version: 1 as const,
      mode: 'LOCAL' as const,
      taskId,
      iteration,
      workspaceId: checkpoint.context.workspaceId,
      baselineSnapshotId: checkpoint.context.baselineSnapshotId,
      reviewSnapshotId: review.snapshotId,
      ...(previous ? { previousReviewSnapshotId: previous } : {}),
      testEvidenceSha256: sha256(canonicalJson(testEvidence)),
      executionSummarySha256: sha256(canonicalJson(executionSummary)),
      testStatus: testEvidence.status,
      changeAttribution: 'UNATTRIBUTED_NET_DELTA' as const,
    };
    const target = LocalReviewTargetV1Schema.parse({
      ...content,
      reviewTargetSha256: localReviewTargetFingerprint(content),
    });
    await this.store.write({
      ...checkpoint,
      reviews: [
        ...checkpoint.reviews,
        { iteration, reviewSnapshotId: review.snapshotId, reviewTarget: target },
      ],
      updatedAt: new Date().toISOString(),
    });
    return target;
  }

  private async recoverReview(
    checkpoint: LocalProviderCheckpointV1,
    iteration: number,
  ): Promise<LocalReviewTargetV1> {
    const persisted = checkpoint.reviews[iteration - 1];
    if (!persisted)
      throw new ChatbridgeError('LOCAL review iteration is invalid', 'LOCAL_ITERATION_MISMATCH');
    const [testEvidence, executionSummary] = await Promise.all([
      this.readTestEvidence(checkpoint.taskId, iteration, persisted.reviewSnapshotId),
      this.readExecutionSummary(checkpoint.taskId, iteration, persisted.reviewSnapshotId),
    ]);
    if (
      sha256(canonicalJson(testEvidence)) !== persisted.reviewTarget.testEvidenceSha256 ||
      sha256(canonicalJson(executionSummary)) !== persisted.reviewTarget.executionSummarySha256 ||
      testEvidence.status !== persisted.reviewTarget.testStatus
    )
      throw new ChatbridgeError(
        'Prepared LOCAL review replay diverged',
        'LOCAL_REVIEW_REPLAY_DIVERGED',
      );
    return validateLocalReviewTargetIntegrity(persisted.reviewTarget);
  }

  private async readTestEvidence(
    taskId: string,
    iteration: number,
    snapshotId: string,
  ): Promise<LocalTestEvidenceV1> {
    const record = LocalTestEvidenceV1Schema.parse(
      await this.evidence.readTestEvidence(taskId, iteration, snapshotId),
    );
    this.assertEvidenceIdentity(record, taskId, iteration, snapshotId);
    return record;
  }

  private async readExecutionSummary(
    taskId: string,
    iteration: number,
    snapshotId: string,
  ): Promise<LocalExecutionSummaryV1> {
    const record = LocalExecutionSummaryV1Schema.parse(
      await this.evidence.readExecutionSummary(taskId, iteration, snapshotId),
    );
    this.assertEvidenceIdentity(record, taskId, iteration, snapshotId);
    return record;
  }

  private assertEvidenceIdentity(
    record: { taskId: string; iteration: number; snapshotId: string },
    taskId: string,
    iteration: number,
    snapshotId: string,
  ): void {
    if (
      record.taskId !== taskId ||
      record.iteration !== iteration ||
      record.snapshotId !== snapshotId
    )
      throw new ChatbridgeError(
        'LOCAL review evidence identity mismatch',
        'LOCAL_EVIDENCE_IDENTITY_MISMATCH',
      );
  }

  async status(taskIdInput: string): Promise<LocalProviderCheckpointV1> {
    return this.requireCheckpoint(taskIdInput);
  }

  private expectedLiveSnapshot(checkpoint: LocalProviderCheckpointV1): string {
    return checkpoint.reviews.at(-1)?.reviewSnapshotId ?? checkpoint.context.baselineSnapshotId;
  }

  private async requireCheckpoint(taskIdInput: string): Promise<LocalProviderCheckpointV1> {
    const taskId = TaskIdSchema.parse(taskIdInput);
    const checkpoint = await this.store.read(taskId);
    if (!checkpoint) throw new ChatbridgeError('LOCAL task was not found', 'TASK_NOT_FOUND');
    return checkpoint;
  }
}

class LocalProviderCheckpointStore {
  constructor(private readonly root: string) {}

  async read(taskId: string): Promise<LocalProviderCheckpointV1 | undefined> {
    try {
      const checkpoint = LocalProviderCheckpointV1Schema.parse(
        JSON.parse(await readFile(this.file(TaskIdSchema.parse(taskId)), 'utf8')),
      );
      checkpoint.reviews.forEach((review) =>
        validateLocalReviewTargetIntegrity(review.reviewTarget),
      );
      return checkpoint;
    } catch (error: any) {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async write(value: LocalProviderCheckpointV1): Promise<void> {
    const parsed = LocalProviderCheckpointV1Schema.parse(value);
    parsed.reviews.forEach((review) => validateLocalReviewTargetIntegrity(review.reviewTarget));
    const file = this.file(parsed.taskId);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, { flag: 'wx' });
      await rename(temporary, file);
    } finally {
      await unlink(temporary).catch((error: any) => {
        if (error?.code !== 'ENOENT') throw error;
      });
    }
  }

  private file(taskId: string): string {
    return path.join(this.root, 'runs', taskId, 'local', 'provider.json');
  }
}
