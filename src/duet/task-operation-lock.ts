import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { TaskIdSchema } from '../core/domain.js';
import { ChatbridgeError } from '../core/errors.js';

type LockOwner = { pid: number; token: string; acquiredAt: string };

export interface TaskOperationLockLike {
  withLock<T>(taskId: string, operation: () => Promise<T>): Promise<T>;
}

export class TaskOperationLock implements TaskOperationLockLike {
  constructor(
    private readonly stateRoot: string,
    private readonly timeoutMs = 15_000,
  ) {}

  async withLock<T>(taskIdInput: string, operation: () => Promise<T>): Promise<T> {
    const taskId = TaskIdSchema.parse(taskIdInput);
    const file = path.join(this.stateRoot, 'locks', 'tasks', `${taskId}.lock`);
    const owner = await this.acquire(file);
    try {
      return await operation();
    } finally {
      await this.release(file, owner);
    }
  }

  private async acquire(file: string): Promise<LockOwner> {
    const deadline = Date.now() + this.timeoutMs;
    const owner: LockOwner = {
      pid: process.pid,
      token: randomBytes(16).toString('hex'),
      acquiredAt: new Date().toISOString(),
    };
    await mkdir(path.dirname(file), { recursive: true });
    while (Date.now() < deadline) {
      try {
        const handle = await open(file, 'wx');
        try {
          await handle.writeFile(JSON.stringify(owner), 'utf8');
        } finally {
          await handle.close();
        }
        return owner;
      } catch (error: any) {
        if (error?.code !== 'EEXIST') throw error;
        await this.recoverDeadOwner(file);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    throw new ChatbridgeError('Timed out waiting for the task operation lock', 'TASK_LOCK_TIMEOUT');
  }

  private async recoverDeadOwner(file: string): Promise<void> {
    try {
      if (Date.now() - (await stat(file)).mtimeMs < 1000) return;
      const raw = await readFile(file, 'utf8');
      const owner = JSON.parse(raw) as Partial<LockOwner>;
      if (!Number.isInteger(owner.pid) || typeof owner.token !== 'string')
        throw new ChatbridgeError('Task operation lock is malformed', 'TASK_LOCK_INVALID');
      try {
        process.kill(owner.pid!, 0);
        return;
      } catch (error: any) {
        if (error?.code !== 'ESRCH') return;
      }
      if ((await readFile(file, 'utf8')) === raw) await unlink(file);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  private async release(file: string, owner: LockOwner): Promise<void> {
    try {
      const current = JSON.parse(await readFile(file, 'utf8')) as Partial<LockOwner>;
      if (current.token !== owner.token)
        throw new ChatbridgeError('Task operation lock ownership changed', 'TASK_LOCK_INVALID');
      await unlink(file);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}
