import { z } from 'zod';
import { ProtocolError } from './errors.js';
import { FullShaSchema, RepositorySchema, TestStatusSchema } from '../github/domain.js';

export const states = [
  'INIT',
  'PLANNING',
  'PLAN',
  'EXECUTING',
  'EXECUTED',
  'REVIEWING',
  'DONE',
  'BLOCKED',
  'FAILED',
  'CANCELLED',
] as const;
export const StateSchema = z.enum(states);
export type TaskState = z.infer<typeof StateSchema>;
export const EnvelopeSchema = z
  .object({
    version: z.literal(1),
    taskId: z.string().min(1).max(128),
    iteration: z.number().int().nonnegative(),
    state: StateSchema,
    mode: z.enum(['LOCAL', 'GITHUB']).optional(),
    repository: RepositorySchema.optional(),
    taskBranch: z
      .string()
      .regex(/^agent\/task-[A-Za-z0-9_-]{1,64}$/)
      .optional(),
    baseRef: FullShaSchema.optional(),
    reviewRef: FullShaSchema.optional(),
    testStatus: TestStatusSchema.optional(),
    content: z.string(),
  })
  .superRefine((value, context) => {
    if (value.mode !== 'GITHUB' || value.state !== 'EXECUTED') return;
    for (const key of ['repository', 'taskBranch', 'baseRef', 'reviewRef', 'testStatus'] as const) {
      if (!value[key])
        context.addIssue({ code: 'custom', path: [key], message: `${key} required` });
    }
  });
export type Envelope = z.infer<typeof EnvelopeSchema>;

export function parseEnvelope(text: string): Envelope {
  const match = text
    .trim()
    .match(/^\[C2C\/(\d+)]\r?\n([\s\S]*?)\r?\n\r?\n([A-Z]+):\r?\n([\s\S]*)$/);
  if (!match) throw new ProtocolError('Malformed C2C envelope');
  const [, version, rawHeaders, section, content] = match;
  const headers = new Map<string, string>();
  const allowedHeaders = new Set([
    'TASK',
    'ITERATION',
    'STATE',
    'MODE',
    'REPOSITORY',
    'TASK_BRANCH',
    'BASE_REF',
    'REVIEW_REF',
    'TEST_STATUS',
  ]);
  for (const line of rawHeaders!.split(/\r?\n/)) {
    const header = line.match(/^([A-Z_]+): (.+)$/);
    if (!header || !allowedHeaders.has(header[1]!) || headers.has(header[1]!))
      throw new ProtocolError('Malformed C2C headers');
    headers.set(header[1]!, header[2]!);
  }
  const state = headers.get('STATE');
  if (section !== state)
    throw new ProtocolError(`Payload section ${section} does not match state ${state}`);
  const parsed = EnvelopeSchema.safeParse({
    version: Number(version),
    taskId: headers.get('TASK'),
    iteration: Number(headers.get('ITERATION')),
    state,
    mode: headers.get('MODE'),
    repository: headers.get('REPOSITORY'),
    taskBranch: headers.get('TASK_BRANCH'),
    baseRef: headers.get('BASE_REF'),
    reviewRef: headers.get('REVIEW_REF'),
    testStatus: headers.get('TEST_STATUS'),
    content,
  });
  if (!parsed.success)
    throw new ProtocolError(
      `Invalid C2C envelope: ${parsed.error.issues[0]?.message ?? 'unknown error'}`,
    );
  return parsed.data;
}
export function serializeEnvelope(value: Envelope): string {
  const e = EnvelopeSchema.parse(value);
  const headers = [
    `[C2C/${e.version}]`,
    `TASK: ${e.taskId}`,
    `ITERATION: ${e.iteration}`,
    `STATE: ${e.state}`,
  ];
  if (e.mode) headers.push(`MODE: ${e.mode}`);
  if (e.repository) headers.push(`REPOSITORY: ${e.repository}`);
  if (e.taskBranch) headers.push(`TASK_BRANCH: ${e.taskBranch}`);
  if (e.baseRef) headers.push(`BASE_REF: ${e.baseRef}`);
  if (e.reviewRef) headers.push(`REVIEW_REF: ${e.reviewRef}`);
  if (e.testStatus) headers.push(`TEST_STATUS: ${e.testStatus}`);
  return `${headers.join('\n')}\n\n${e.state}:\n${e.content}`;
}
