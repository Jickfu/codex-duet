import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ChatbridgeError } from './errors.js';
import { TaskCheckpointSchema, type TaskCheckpoint } from './task.js';
const MessageIdSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);
const SessionSchema = z.object({
  version: z.literal(2),
  conversationUrl: z.string().url(),
  outgoingUserMessageId: MessageIdSchema,
  previousAssistantMessageId: MessageIdSchema.optional(),
  sentAt: z.string().datetime(),
});
export type SendCheckpointV2 = z.infer<typeof SessionSchema>;
export type BridgeSession = SendCheckpointV2;
export class SessionStore {
  private readonly file: string;
  constructor(root: string) {
    this.file = path.join(root, 'session.json');
  }
  async read(): Promise<BridgeSession | undefined> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      if (typeof raw === 'object' && raw !== null && 'assistantCount' in raw && !('version' in raw))
        throw new ChatbridgeError(
          'Assistant-count checkpoints are stale and unsupported; run send again',
          'STALE_SEND_CHECKPOINT',
        );
      return SessionSchema.parse(raw);
    } catch (e: any) {
      if (e?.code === 'ENOENT') return undefined;
      throw e;
    }
  }
  async write(value: BridgeSession) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
    await rename(tmp, this.file);
  }
}

export class TaskCheckpointStore {
  constructor(private readonly root: string) {}

  private pathFor(taskId: string) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(taskId))
      throw new ChatbridgeError('Invalid task ID for checkpoint path', 'INVALID_TASK_ID');
    return path.join(this.root, 'tasks', `${taskId}.json`);
  }

  async read(taskId: string): Promise<TaskCheckpoint | undefined> {
    try {
      return TaskCheckpointSchema.parse(JSON.parse(await readFile(this.pathFor(taskId), 'utf8')));
    } catch (error: any) {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async write(value: TaskCheckpoint) {
    const checkpoint = TaskCheckpointSchema.parse(value);
    const file = this.pathFor(checkpoint.taskId);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(checkpoint, null, 2), 'utf8');
    await rename(temporary, file);
  }
}
