import { z } from 'zod';
import { TaskIdSchema } from '../core/domain.js';
import { ChatbridgeError } from '../core/errors.js';
import { canonicalJson, sha256 } from '../duet/task-spec.js';
import { Sha256Schema } from './domain.js';

export const LocalDecisionInputSchema = z
  .object({
    blockedControlSha256: Sha256Schema,
    decision: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => value.trim().length > 0),
    scopeUnchanged: z.literal(true),
  })
  .strict();
export type LocalDecisionInput = z.infer<typeof LocalDecisionInputSchema>;

export const LocalUserDecisionV1Schema = LocalDecisionInputSchema.extend({
  version: z.literal(1),
  taskId: TaskIdSchema,
  taskSpecSha256: Sha256Schema,
  blockedResponseSha256: Sha256Schema,
  blockedResult: z
    .string()
    .min(1)
    .max(64 * 1024),
  sequence: z.number().int().min(1).max(100),
  iteration: z.number().int().min(1).max(100),
  planningSnapshotId: Sha256Schema,
  previousDecisionSha256: Sha256Schema.optional(),
  recordedAt: z.string().datetime(),
  decisionSha256: Sha256Schema,
}).strict();
export type LocalUserDecisionV1 = z.infer<typeof LocalUserDecisionV1Schema>;

export function decisionFingerprint(value: Omit<LocalUserDecisionV1, 'decisionSha256'>) {
  return sha256(canonicalJson(value));
}

export function validateDecision(value: unknown): LocalUserDecisionV1 {
  const record = LocalUserDecisionV1Schema.parse(value);
  const { decisionSha256, ...content } = record;
  if (decisionSha256 !== decisionFingerprint(content))
    throw new ChatbridgeError('LOCAL user decision integrity mismatch', 'LOCAL_DECISION_INVALID');
  return record;
}
