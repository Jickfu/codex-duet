import { z } from 'zod';
import { TaskIdSchema } from '../core/domain.js';
import { BrowserControlProviderSchema } from './interaction-policy.js';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const CompactTextSchema = z.string().trim().min(1).max(8192);

export const DiscussionControlV1Schema = z
  .object({
    version: z.literal(1),
    kind: z.literal('DISCUSSION_CONTROL'),
    taskId: TaskIdSchema,
    iteration: z.number().int().positive(),
    round: z.number().int().min(1).max(3),
    provider: BrowserControlProviderSchema,
    taskSpecSha256: Sha256Schema,
    interactionPolicySha256: Sha256Schema,
    previousResponseSha256: Sha256Schema.optional(),
    requestSha256: Sha256Schema,
    content: CompactTextSchema,
  })
  .strict();

export const DiscussionResponseV1Schema = z
  .object({
    version: z.literal(1),
    kind: z.literal('DISCUSSION_RESPONSE'),
    taskId: TaskIdSchema,
    iteration: z.number().int().positive(),
    round: z.number().int().min(1).max(3),
    provider: BrowserControlProviderSchema,
    taskSpecSha256: Sha256Schema,
    controlSha256: Sha256Schema,
    requestSha256: Sha256Schema,
    outcome: z.enum(['CONTINUE', 'CONVERGED', 'USER_DECISION_REQUIRED', 'FAILED']),
    content: CompactTextSchema,
  })
  .strict();

export const DiscussionSummaryV1Schema = z
  .object({
    version: z.literal(1),
    taskId: TaskIdSchema,
    provider: BrowserControlProviderSchema,
    maxRounds: z.literal(3),
    rounds: z.array(
      z
        .object({
          round: z.number().int().min(1).max(3),
          requestSha256: Sha256Schema,
          responseSha256: Sha256Schema.optional(),
          outcome: z.enum(['CONTINUE', 'CONVERGED', 'USER_DECISION_REQUIRED', 'FAILED']).optional(),
        })
        .strict(),
    ),
    status: z.enum(['ACTIVE', 'CONVERGED', 'BLOCKED', 'FAILED']),
  })
  .strict();

export type DiscussionControlV1 = z.infer<typeof DiscussionControlV1Schema>;
export type DiscussionResponseV1 = z.infer<typeof DiscussionResponseV1Schema>;
export type DiscussionSummaryV1 = z.infer<typeof DiscussionSummaryV1Schema>;
