import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { TaskCheckpointSchema, type TaskCheckpoint } from './task.js';
const SessionSchema = z.object({
  assistantCount: z.number().int().nonnegative(),
  sentAt: z.string().datetime(),
});
export type BridgeSession = z.infer<typeof SessionSchema>;
export class SessionStore {
  private readonly file: string;
  constructor(root: string) {
    this.file = path.join(root, 'session.json');
  }
  async read(): Promise<BridgeSession | undefined> {
    try {
      return SessionSchema.parse(JSON.parse(await readFile(this.file, 'utf8')));
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
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(taskId))
      throw new Error('Invalid task ID for checkpoint path');
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
