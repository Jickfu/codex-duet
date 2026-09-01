import { z } from 'zod';
import { ProtocolError } from './errors.js';

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
export const EnvelopeSchema = z.object({
  version: z.literal(1),
  taskId: z.string().min(1).max(128),
  iteration: z.number().int().nonnegative(),
  state: StateSchema,
  content: z.string(),
});
export type Envelope = z.infer<typeof EnvelopeSchema>;

const HEADER =
  /^\[C2C\/(\d+)]\r?\nTASK: ([^\r\n]+)\r?\nITERATION: (\d+)\r?\nSTATE: ([A-Z]+)\r?\n\r?\n([A-Z]+):\r?\n([\s\S]*)$/;
export function parseEnvelope(text: string): Envelope {
  const match = text.trim().match(HEADER);
  if (!match) throw new ProtocolError('Malformed C2C envelope');
  const [, version, taskId, iteration, state, section, content] = match;
  if (section !== state)
    throw new ProtocolError(`Payload section ${section} does not match state ${state}`);
  const parsed = EnvelopeSchema.safeParse({
    version: Number(version),
    taskId,
    iteration: Number(iteration),
    state,
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
  return `[C2C/${e.version}]\nTASK: ${e.taskId}\nITERATION: ${e.iteration}\nSTATE: ${e.state}\n\n${e.state}:\n${e.content}`;
}
