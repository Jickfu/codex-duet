import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ChatbridgeError } from '../core/errors.js';
import { TaskIdSchema } from '../core/domain.js';

const MessageIdSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);

export const TaskBrowserBindingV1Schema = z
  .object({
    version: z.literal(1),
    taskId: TaskIdSchema,
    conversation: z
      .object({
        url: z.string().url(),
        boundAt: z.string().datetime(),
      })
      .strict(),
    pendingSend: z
      .object({
        outgoingUserMessageId: MessageIdSchema,
        previousAssistantMessageId: MessageIdSchema.optional(),
        sentAt: z.string().datetime(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type TaskBrowserBindingV1 = z.infer<typeof TaskBrowserBindingV1Schema>;

export class TaskBrowserStore {
  constructor(private readonly stateRoot: string) {}

  async read(taskIdInput: string): Promise<TaskBrowserBindingV1 | undefined> {
    const taskId = this.taskId(taskIdInput);
    try {
      return TaskBrowserBindingV1Schema.parse(
        JSON.parse(await readFile(this.pathFor(taskId), 'utf8')),
      );
    } catch (error: any) {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async write(value: TaskBrowserBindingV1): Promise<void> {
    const binding = TaskBrowserBindingV1Schema.parse(value);
    const file = this.pathFor(binding.taskId);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, JSON.stringify(binding, null, 2), 'utf8');
    await rename(temporary, file);
  }

  async list(): Promise<TaskBrowserBindingV1[]> {
    const runs = path.join(this.stateRoot, 'runs');
    let entries;
    try {
      entries = await readdir(runs, { withFileTypes: true });
    } catch (error: any) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    const result: TaskBrowserBindingV1[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const taskId = this.taskId(entry.name);
      const binding = await this.read(taskId);
      if (binding) result.push(binding);
    }
    return result;
  }

  pathFor(taskIdInput: string): string {
    return path.join(this.stateRoot, 'runs', this.taskId(taskIdInput), 'browser.json');
  }

  private taskId(input: string): string {
    const parsed = TaskIdSchema.safeParse(input);
    if (!parsed.success)
      throw new ChatbridgeError('Invalid task ID for browser state path', 'INVALID_TASK_ID');
    return parsed.data;
  }
}
