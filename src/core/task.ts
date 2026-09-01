import { z } from 'zod';
import { StateSchema } from './protocol.js';
import {
  FullShaSchema,
  RepositorySchema,
  TaskIdSchema,
  TestStatusSchema,
} from '../github/domain.js';

export const TaskCheckpointSchema = z
  .object({
    version: z.literal(1),
    taskId: TaskIdSchema,
    mode: z.enum(['LOCAL', 'GITHUB']),
    iteration: z.number().int().nonnegative(),
    state: StateSchema,
    conversationRef: z.string().min(1).optional(),
    repository: RepositorySchema.optional(),
    remote: z
      .string()
      .regex(/^[A-Za-z0-9._-]+$/)
      .optional(),
    taskBranch: z
      .string()
      .regex(/^agent\/task-[A-Za-z0-9_-]{1,64}$/)
      .optional(),
    baseRef: FullShaSchema.optional(),
    reviewRef: FullShaSchema.optional(),
    testStatus: TestStatusSchema.optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .superRefine((value, context) => {
    if (value.mode !== 'GITHUB') return;
    for (const key of ['repository', 'remote', 'taskBranch', 'baseRef'] as const) {
      if (!value[key])
        context.addIssue({ code: 'custom', path: [key], message: `${key} required` });
    }
    if (value.state === 'EXECUTED') {
      for (const key of ['reviewRef', 'testStatus'] as const) {
        if (!value[key])
          context.addIssue({ code: 'custom', path: [key], message: `${key} required` });
      }
    }
  });

export type TaskCheckpoint = z.infer<typeof TaskCheckpointSchema>;
