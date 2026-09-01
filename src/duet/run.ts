import { z } from 'zod';
import { TaskIdSchema } from '../core/domain.js';
import { StateSchema } from '../core/protocol.js';
import { FullShaSchema, RepositorySchema, TaskBranchSchema } from '../core/github-fields.js';
import { TestStatusSchema } from '../core/domain.js';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const DuetRunCheckpointV1Schema = z
  .object({
    version: z.literal(1),
    taskId: TaskIdSchema,
    mode: z.literal('GITHUB'),
    iteration: z.number().int().positive(),
    state: StateSchema,
    context: z
      .object({
        mode: z.literal('GITHUB'),
        repository: RepositorySchema,
        remote: z.string().regex(/^[A-Za-z0-9._-]+$/),
        taskId: TaskIdSchema,
        taskBranch: TaskBranchSchema,
        baseRef: FullShaSchema,
      })
      .strict(),
    request: z.object({ sha256: Sha256Schema }).strict(),
    plan: z.object({ sha256: Sha256Schema }).strict().optional(),
    reviewTarget: z
      .object({
        mode: z.literal('GITHUB'),
        repository: RepositorySchema,
        remote: z.string().regex(/^[A-Za-z0-9._-]+$/),
        taskId: TaskIdSchema,
        taskBranch: TaskBranchSchema,
        baseRef: FullShaSchema,
        reviewRef: FullShaSchema,
        testStatus: TestStatusSchema,
      })
      .strict()
      .optional(),
    blockedPhase: z.enum(['PLANNING', 'EXECUTING', 'REVIEWING']).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((value, context) => {
    if (['PLAN', 'EXECUTING', 'EXECUTED', 'REVIEWING', 'DONE'].includes(value.state) && !value.plan)
      context.addIssue({ code: 'custom', path: ['plan'], message: 'plan required' });
    if (['EXECUTED', 'REVIEWING', 'DONE'].includes(value.state) && !value.reviewTarget)
      context.addIssue({
        code: 'custom',
        path: ['reviewTarget'],
        message: 'reviewTarget required',
      });
    if (value.state === 'BLOCKED' && !value.blockedPhase)
      context.addIssue({
        code: 'custom',
        path: ['blockedPhase'],
        message: 'blockedPhase required',
      });
  });

export type DuetRunCheckpointV1 = z.infer<typeof DuetRunCheckpointV1Schema>;
