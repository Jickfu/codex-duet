import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ChatbridgeError } from '../core/errors.js';
import { TaskIdSchema } from '../core/domain.js';
import { canonicalJson } from './task-spec.js';
import {
  TaskInteractionPolicyV1Schema,
  type TaskInteractionPolicyV1,
} from './interaction-policy.js';

export class TaskInteractionPolicyStore {
  constructor(private readonly stateRoot: string) {}

  async read(taskIdInput: string): Promise<TaskInteractionPolicyV1 | undefined> {
    const taskId = this.taskId(taskIdInput);
    try {
      const policy = TaskInteractionPolicyV1Schema.parse(
        JSON.parse(await readFile(this.pathFor(taskId), 'utf8')),
      );
      if (policy.taskId !== taskId)
        throw new ChatbridgeError(
          'Interaction policy task ID does not match its path',
          'INTERACTION_POLICY_TASK_MISMATCH',
        );
      return policy;
    } catch (error: any) {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async createOrVerify(value: TaskInteractionPolicyV1): Promise<void> {
    const policy = TaskInteractionPolicyV1Schema.parse(value);
    const file = this.pathFor(policy.taskId);
    const serialized = `${canonicalJson(policy)}\n`;
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx' });
      await link(temporary, file);
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = await this.read(policy.taskId);
      if (!existing || `${canonicalJson(existing)}\n` !== serialized)
        throw new ChatbridgeError(
          'Interaction policy already exists with different content',
          'INTERACTION_POLICY_IMMUTABLE',
        );
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  pathFor(taskIdInput: string): string {
    return path.join(this.stateRoot, 'runs', this.taskId(taskIdInput), 'interaction.json');
  }

  private taskId(input: string): string {
    const parsed = TaskIdSchema.safeParse(input);
    if (!parsed.success)
      throw new ChatbridgeError('Invalid task ID for interaction policy path', 'INVALID_TASK_ID');
    return parsed.data;
  }
}
