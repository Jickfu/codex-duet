import { createHash } from 'node:crypto';
import { z } from 'zod';
import { TaskIdSchema } from '../core/domain.js';
import { FullShaSchema, RepositorySchema, TaskBranchSchema } from '../core/github-fields.js';
import { ChatbridgeError } from '../core/errors.js';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const NonEmptyTextSchema = z.string().trim().min(1);

const AcceptanceCriterionSchema = z
  .object({
    id: NonEmptyTextSchema,
    requirement: NonEmptyTextSchema,
    priority: z.enum(['MUST', 'SHOULD']),
  })
  .strict();

const ExactLiteralSchema = z
  .object({
    id: NonEmptyTextSchema,
    value: z.string().min(1),
    usage: NonEmptyTextSchema,
    caseSensitive: z.boolean(),
  })
  .strict();

const ProtocolRequirementSchema = z
  .object({
    id: NonEmptyTextSchema,
    requirement: NonEmptyTextSchema,
    replaySafety: z.enum(['IDEMPOTENT', 'NON_IDEMPOTENT', 'UNKNOWN']),
  })
  .strict();

export const TaskSpecV1Schema = z
  .object({
    version: z.literal(1),
    taskId: TaskIdSchema,
    mode: z.enum(['GITHUB', 'LOCAL']),
    objective: NonEmptyTextSchema,
    scope: z
      .object({
        allowed: z.array(NonEmptyTextSchema),
        forbidden: z.array(NonEmptyTextSchema),
      })
      .strict(),
    acceptanceCriteria: z.array(AcceptanceCriterionSchema),
    exactLiterals: z.array(ExactLiteralSchema),
    protocolRequirements: z.array(ProtocolRequirementSchema),
    guidance: z
      .object({
        plannerNotes: z.array(NonEmptyTextSchema).optional(),
        reviewCriteria: z.array(NonEmptyTextSchema).optional(),
      })
      .strict()
      .optional(),
    context: z
      .object({
        repository: RepositorySchema.optional(),
        taskBranch: TaskBranchSchema.optional(),
        baseRef: FullShaSchema.optional(),
      })
      .strict(),
    source: z.object({ rawRequestSha256: Sha256Schema }).strict(),
    contracts: z
      .object({
        plannerPath: z.literal('docs/contracts/planner-v1.md'),
        reviewerPath: z.literal('docs/contracts/reviewer-v1.md'),
        resolution: z.literal('AT_BASE_REF'),
      })
      .strict(),
    integrity: z.object({ sha256: Sha256Schema }).strict(),
  })
  .strict();

export type TaskSpecV1 = z.infer<typeof TaskSpecV1Schema>;
export type TaskSpecWithoutIntegrity = Omit<TaskSpecV1, 'integrity'>;

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function taskSpecFingerprint(value: TaskSpecWithoutIntegrity): string {
  return sha256(canonicalJson(value));
}

export function validateTaskSpecCandidate(
  candidate: unknown,
  expected: {
    taskId: string;
    mode: 'GITHUB' | 'LOCAL';
    rawRequest: string;
    context?: { repository: string; taskBranch: string; baseRef: string };
  },
): TaskSpecV1 {
  const spec = TaskSpecV1Schema.parse(candidate);
  if (spec.taskId !== expected.taskId)
    throw new ChatbridgeError(
      'TaskSpec task ID does not match init task',
      'TASK_SPEC_TASK_MISMATCH',
    );
  if (spec.mode !== expected.mode)
    throw new ChatbridgeError(
      'TaskSpec mode does not match durable mode',
      'TASK_SPEC_MODE_MISMATCH',
    );
  if (spec.source.rawRequestSha256 !== sha256(expected.rawRequest))
    throw new ChatbridgeError(
      'TaskSpec raw request fingerprint does not match request file',
      'TASK_SPEC_REQUEST_MISMATCH',
    );
  for (const literal of spec.exactLiterals) {
    if (literal.usage.startsWith('SYSTEM_GENERATED:')) continue;
    if (!expected.rawRequest.includes(literal.value))
      throw new ChatbridgeError(
        `TaskSpec exact literal ${literal.id} is absent from the raw request`,
        'TASK_SPEC_LITERAL_MISMATCH',
      );
  }
  if (expected.context) {
    const actual = spec.context;
    if (
      actual.repository !== expected.context.repository ||
      actual.taskBranch !== expected.context.taskBranch ||
      actual.baseRef !== expected.context.baseRef
    )
      throw new ChatbridgeError(
        'TaskSpec context does not match durable GitHub identity',
        'TASK_SPEC_CONTEXT_MISMATCH',
      );
  }
  const content = Object.fromEntries(
    Object.entries(spec).filter(([key]) => key !== 'integrity'),
  ) as TaskSpecWithoutIntegrity;
  if (spec.integrity.sha256 !== taskSpecFingerprint(content))
    throw new ChatbridgeError(
      'TaskSpec integrity fingerprint is invalid',
      'TASK_SPEC_INTEGRITY_INVALID',
    );
  return spec;
}

export function serializeTaskSpec(value: TaskSpecV1): string {
  return `${canonicalJson(TaskSpecV1Schema.parse(value))}\n`;
}
