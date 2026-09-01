import { z } from 'zod';
import { TaskIdSchema } from '../core/domain.js';
import { StateSchema } from '../core/protocol.js';
import { FullShaSchema, RepositorySchema, TaskBranchSchema } from '../core/github-fields.js';
import { TestStatusSchema } from '../core/domain.js';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const MaxIterationsSchema = z.number().int().min(1).max(100);

const GitHubContextRefSchema = z
  .object({
    mode: z.literal('GITHUB'),
    repository: RepositorySchema,
    remote: z.string().regex(/^[A-Za-z0-9._-]+$/),
    taskId: TaskIdSchema,
    taskBranch: TaskBranchSchema,
    baseRef: FullShaSchema,
  })
  .strict();

const GitHubReviewTargetSchema = GitHubContextRefSchema.extend({
  reviewRef: FullShaSchema,
  testStatus: TestStatusSchema,
}).strict();

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

export const DuetIterationRecordSchema = z
  .object({
    iteration: z.number().int().positive(),
    plan: z.union([
      z.object({ sha256: Sha256Schema }).strict(),
      z.object({ legacyEvidenceUnavailable: z.literal(true) }).strict(),
    ]),
    reviewTarget: GitHubReviewTargetSchema.optional(),
  })
  .strict();

export const DuetRunCheckpointV2Schema = z
  .object({
    version: z.literal(2),
    taskId: TaskIdSchema,
    mode: z.literal('GITHUB'),
    iteration: z.number().int().positive(),
    state: StateSchema,
    context: GitHubContextRefSchema,
    request: z.object({ sha256: Sha256Schema }).strict(),
    iterations: z.array(DuetIterationRecordSchema),
    limits: z.object({ maxIterations: MaxIterationsSchema }).strict(),
    blockedPhase: z.enum(['PLANNING', 'EXECUTING', 'REVIEWING']).optional(),
    halt: z
      .object({
        code: z.literal('ITERATION_LIMIT_REACHED'),
        iteration: z.number().int().positive(),
      })
      .strict()
      .optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((value, refinement) => {
    if (
      value.context.taskId !== value.taskId ||
      value.context.taskBranch !== `agent/task-${value.taskId}`
    )
      refinement.addIssue({
        code: 'custom',
        path: ['context'],
        message: 'run context does not match task identity',
      });
    value.iterations.forEach((record, index) => {
      const expected = index + 1;
      if (record.iteration !== expected)
        refinement.addIssue({
          code: 'custom',
          path: ['iterations', index, 'iteration'],
          message: `expected iteration ${expected}`,
        });
      if (record.reviewTarget) {
        const target = record.reviewTarget;
        if (
          target.taskId !== value.taskId ||
          target.repository !== value.context.repository ||
          target.remote !== value.context.remote ||
          target.taskBranch !== value.context.taskBranch ||
          target.baseRef !== value.context.baseRef
        )
          refinement.addIssue({
            code: 'custom',
            path: ['iterations', index, 'reviewTarget'],
            message: 'review target does not match run context',
          });
      }
    });

    const current = value.iterations[value.iteration - 1];
    const needsPlan =
      ['PLAN', 'EXECUTING', 'EXECUTED', 'REVIEWING', 'DONE'].includes(value.state) ||
      (value.state === 'BLOCKED' && value.blockedPhase !== 'PLANNING');
    const needsReview =
      ['EXECUTED', 'REVIEWING', 'DONE'].includes(value.state) ||
      (value.state === 'BLOCKED' && value.blockedPhase === 'REVIEWING');
    if (needsPlan && !current)
      refinement.addIssue({
        code: 'custom',
        path: ['iterations'],
        message: 'current iteration plan required',
      });
    if (value.iterations.length > value.iteration)
      refinement.addIssue({ code: 'custom', path: ['iterations'], message: 'future iteration' });
    if (needsReview && !current?.reviewTarget)
      refinement.addIssue({
        code: 'custom',
        path: ['iterations', value.iteration - 1, 'reviewTarget'],
        message: 'current iteration review target required',
      });
    if (value.state === 'PLANNING' && value.iterations.length !== 0)
      refinement.addIssue({
        code: 'custom',
        path: ['iterations'],
        message: 'PLANNING must not have iteration records',
      });
    if (value.state === 'BLOCKED' && !value.blockedPhase)
      refinement.addIssue({
        code: 'custom',
        path: ['blockedPhase'],
        message: 'blockedPhase required',
      });
    if (value.halt) {
      if (
        value.state !== 'REVIEWING' ||
        value.halt.iteration !== value.iteration + 1 ||
        value.halt.iteration <= value.limits.maxIterations
      )
        refinement.addIssue({ code: 'custom', path: ['halt'], message: 'invalid halt evidence' });
    }
  });

export const DuetRunCheckpointSchema = z.union([
  DuetRunCheckpointV1Schema,
  DuetRunCheckpointV2Schema,
]);

export type DuetIterationRecord = z.infer<typeof DuetIterationRecordSchema>;
export type DuetRunCheckpointV2 = z.infer<typeof DuetRunCheckpointV2Schema>;
export type DuetRunCheckpoint = z.infer<typeof DuetRunCheckpointSchema>;
