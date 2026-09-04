import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TaskIdSchema } from '../core/domain.js';
import { ChatbridgeError } from '../core/errors.js';
import { canonicalJson, sha256 } from '../duet/task-spec.js';
import { Sha256Schema } from './domain.js';
import { LocalDecisionInputSchema } from './user-decision.js';

export const DiscussionDecisionSchema = LocalDecisionInputSchema.extend({
  version: z.literal(1),
  taskId: TaskIdSchema,
  taskSpecSha256: Sha256Schema,
  interactionPolicySha256: Sha256Schema,
  baselineSnapshotId: Sha256Schema,
  blockedResponseSha256: Sha256Schema,
  blockedRound: z.number().int().min(1).max(3),
  blockedResult: z.string().min(1).max(8192),
  recordedAt: z.string().datetime(),
  decisionSha256: Sha256Schema,
}).strict();
export type DiscussionDecision = z.infer<typeof DiscussionDecisionSchema>;
export function discussionDecisionHash(value: Omit<DiscussionDecision, 'decisionSha256'>) {
  return sha256(canonicalJson(value));
}
export function validateDiscussionDecision(value: unknown) {
  const record = DiscussionDecisionSchema.parse(value);
  const { decisionSha256, ...content } = record;
  if (decisionSha256 !== discussionDecisionHash(content))
    throw new ChatbridgeError(
      'Discussion decision integrity mismatch',
      'DISCUSSION_DECISION_INVALID',
    );
  return record;
}
export class DiscussionDecisionStore {
  constructor(private readonly root: string) {}
  async read(taskId: string) {
    try {
      const value = validateDiscussionDecision(
        JSON.parse(await readFile(this.file(taskId), 'utf8')),
      );
      if (value.taskId !== taskId)
        throw new ChatbridgeError(
          'Discussion decision task mismatch',
          'DISCUSSION_DECISION_INVALID',
        );
      return value;
    } catch (error: any) {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    }
  }
  async create(value: DiscussionDecision) {
    const record = validateDiscussionDecision(value);
    const file = this.file(record.taskId);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, canonicalJson(record) + '\n', { flag: 'wx', mode: 0o600 });
      await link(temporary, file);
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      if (canonicalJson(await this.read(record.taskId)) !== canonicalJson(record))
        throw new ChatbridgeError(
          'Only one immutable Discussion supplement is allowed',
          'DISCUSSION_SUPPLEMENT_IMMUTABLE',
        );
    } finally {
      await unlink(temporary).catch((error: any) => {
        if (error?.code !== 'ENOENT') throw error;
      });
    }
  }
  private file(taskId: string) {
    return path.join(
      this.root,
      'runs',
      TaskIdSchema.parse(taskId),
      'discussion',
      'local-supplement',
      'decision.json',
    );
  }
}
