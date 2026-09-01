import { z } from 'zod';
import { TaskIdSchema, TestStatusSchema } from '../core/domain.js';
import { FullShaSchema, TaskBranchSchema } from '../core/github-fields.js';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const ExecutionCheckpointV1Schema = z
  .object({
    version: z.literal(1),
    taskId: TaskIdSchema,
    iteration: z.number().int().positive(),
    planSha256: Sha256Schema,
    baseline: z
      .object({
        taskBranch: TaskBranchSchema,
        head: FullShaSchema,
      })
      .strict(),
    startedAt: z.string().datetime(),
    tests: z
      .object({
        status: TestStatusSchema,
        head: FullShaSchema,
        recordedAt: z.string().datetime(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ExecutionCheckpointV1 = z.infer<typeof ExecutionCheckpointV1Schema>;
