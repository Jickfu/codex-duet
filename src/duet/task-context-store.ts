import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { TaskIdSchema } from '../core/domain.js';
import { ChatbridgeError } from '../core/errors.js';
import { canonicalJson } from './task-spec.js';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const TaskContextV1Schema = z
  .object({
    version: z.literal(1),
    taskId: TaskIdSchema,
    taskSpecSha256: Sha256Schema,
    plannerControlSha256: Sha256Schema,
  })
  .strict();

export type TaskContextV1 = z.infer<typeof TaskContextV1Schema>;

export class TaskContextStore {
  constructor(private readonly stateRoot: string) {}

  async read(taskIdInput: string): Promise<TaskContextV1 | undefined> {
    const taskId = this.taskId(taskIdInput);
    try {
      const context = TaskContextV1Schema.parse(
        JSON.parse(await readFile(this.pathFor(taskId), 'utf8')),
      );
      if (context.taskId !== taskId)
        throw new ChatbridgeError(
          'TaskContext task ID does not match its path',
          'TASK_CONTEXT_TASK_MISMATCH',
        );
      return context;
    } catch (error: any) {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async createOrVerify(value: TaskContextV1): Promise<void> {
    const context = TaskContextV1Schema.parse(value);
    const file = this.pathFor(context.taskId);
    const serialized = serializeTaskContext(context);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx' });
      await link(temporary, file);
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = await this.read(context.taskId);
      if (!existing || serializeTaskContext(existing) !== serialized)
        throw new ChatbridgeError(
          'TaskContext already exists with different compact-task evidence',
          'TASK_CONTEXT_IMMUTABLE',
        );
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  pathFor(taskIdInput: string): string {
    return path.join(this.stateRoot, 'runs', this.taskId(taskIdInput), 'task-context.json');
  }

  private taskId(input: string): string {
    const parsed = TaskIdSchema.safeParse(input);
    if (!parsed.success)
      throw new ChatbridgeError('Invalid task ID for TaskContext path', 'INVALID_TASK_ID');
    return parsed.data;
  }
}

function serializeTaskContext(value: TaskContextV1): string {
  return `${canonicalJson(TaskContextV1Schema.parse(value))}\n`;
}
