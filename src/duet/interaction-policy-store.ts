import { link, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
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

  async setBeforeLock(value: TaskInteractionPolicyV1): Promise<void> {
    const policy = TaskInteractionPolicyV1Schema.parse(value);
    if (await this.isLocked(policy.taskId)) {
      await this.createOrVerify(policy);
      return;
    }
    const file = this.pathFor(policy.taskId);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${canonicalJson(policy)}\n`, 'utf8');
    await rename(temporary, file);
  }

  async lock(taskIdInput: string): Promise<void> {
    const taskId = this.taskId(taskIdInput);
    const policy = await this.read(taskId);
    if (!policy)
      throw new ChatbridgeError(
        'New task Browser control requires an interaction policy',
        'INTERACTION_POLICY_REQUIRED',
      );
    const file = this.lockPath(taskId);
    await mkdir(path.dirname(file), { recursive: true });
    try {
      await writeFile(file, `${canonicalJson(policy)}\n`, { encoding: 'utf8', flag: 'wx' });
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      const locked = TaskInteractionPolicyV1Schema.parse(JSON.parse(await readFile(file, 'utf8')));
      if (canonicalJson(locked) !== canonicalJson(policy))
        throw new ChatbridgeError(
          'Interaction policy differs from the policy locked at first control preparation',
          'INTERACTION_POLICY_IMMUTABLE',
        );
    }
  }

  async isLocked(taskIdInput: string): Promise<boolean> {
    try {
      await readFile(this.lockPath(this.taskId(taskIdInput)), 'utf8');
      return true;
    } catch (error: any) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }

  pathFor(taskIdInput: string): string {
    return path.join(this.stateRoot, 'runs', this.taskId(taskIdInput), 'interaction.json');
  }

  private lockPath(taskId: string): string {
    return path.join(this.stateRoot, 'runs', taskId, 'interaction-lock.json');
  }

  private taskId(input: string): string {
    const parsed = TaskIdSchema.safeParse(input);
    if (!parsed.success)
      throw new ChatbridgeError('Invalid task ID for interaction policy path', 'INVALID_TASK_ID');
    return parsed.data;
  }
}
