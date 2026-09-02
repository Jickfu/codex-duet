import { z } from 'zod';
import { TaskIdSchema } from '../core/domain.js';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const CodexBrowserControlV1Schema = z
  .object({
    version: z.literal(1),
    taskId: TaskIdSchema,
    provider: z.literal('CODEX_BROWSER'),
    conversationUrl: z.string().url().optional(),
    operation: z
      .object({
        operationId: Sha256Schema,
        kind: z.enum(['DISCUSSION', 'PLANNER', 'REVIEWER']),
        iteration: z.number().int().positive(),
        round: z.number().int().min(1).max(3).optional(),
        outboundSha256: Sha256Schema,
        state: z.enum(['PREPARED', 'ATTEMPTED', 'CONFIRMED', 'OUTCOME_UNKNOWN', 'RESPONDED']),
        preparedAt: z.string().datetime(),
        completedAt: z.string().datetime().optional(),
        inboundSha256: Sha256Schema.optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, refinement) => {
    if (value.operation.kind === 'DISCUSSION' && value.operation.round === undefined)
      refinement.addIssue({
        code: 'custom',
        path: ['operation', 'round'],
        message: 'round required',
      });
    if (value.operation.kind !== 'DISCUSSION' && value.operation.round !== undefined)
      refinement.addIssue({
        code: 'custom',
        path: ['operation', 'round'],
        message: 'round forbidden',
      });
    if (
      ['CONFIRMED', 'OUTCOME_UNKNOWN', 'RESPONDED'].includes(value.operation.state) &&
      !value.operation.completedAt
    )
      refinement.addIssue({
        code: 'custom',
        path: ['operation', 'completedAt'],
        message: 'completedAt required',
      });
    if (value.operation.inboundSha256 && value.operation.state !== 'RESPONDED')
      refinement.addIssue({
        code: 'custom',
        path: ['operation', 'inboundSha256'],
        message: 'confirmed send required',
      });
  });

export type CodexBrowserControlV1 = z.infer<typeof CodexBrowserControlV1Schema>;
