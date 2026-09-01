import { z } from 'zod';
import { TaskIdSchema, TestStatusSchema } from './domain.js';
import { StateSchema } from './protocol.js';
import {
  FullShaSchema,
  RemoteNameSchema,
  RepositorySchema,
  TaskBranchSchema,
} from './github-fields.js';

const BaseTaskCheckpointShape = {
  version: z.literal(1),
  taskId: TaskIdSchema,
  iteration: z.number().int().nonnegative(),
  state: StateSchema,
  conversationRef: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
};

export const LocalTaskCheckpointSchema = z
  .object({
    ...BaseTaskCheckpointShape,
    mode: z.literal('LOCAL'),
  })
  .strict();

export const GitHubTaskCheckpointSchema = z
  .object({
    ...BaseTaskCheckpointShape,
    mode: z.literal('GITHUB'),
    repository: RepositorySchema,
    remote: RemoteNameSchema,
    taskBranch: TaskBranchSchema,
    baseRef: FullShaSchema,
    reviewRef: FullShaSchema.optional(),
    testStatus: TestStatusSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.state !== 'EXECUTED') return;
    for (const key of ['reviewRef', 'testStatus'] as const) {
      if (!value[key])
        context.addIssue({ code: 'custom', path: [key], message: `${key} required` });
    }
  });

export const TaskCheckpointSchema = z.discriminatedUnion('mode', [
  LocalTaskCheckpointSchema,
  GitHubTaskCheckpointSchema,
]);

export type LocalTaskCheckpoint = z.infer<typeof LocalTaskCheckpointSchema>;
export type GitHubTaskCheckpoint = z.infer<typeof GitHubTaskCheckpointSchema>;
export type TaskCheckpoint = z.infer<typeof TaskCheckpointSchema>;
