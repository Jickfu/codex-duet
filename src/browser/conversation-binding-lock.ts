import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ChatbridgeError } from '../core/errors.js';

type LockOwner = { pid: number; token: string; acquiredAt: string };

export class ConversationBindingLock {
  private readonly file: string;

  constructor(
    stateRoot: string,
    private readonly timeoutMs = 15_000,
  ) {
    this.file = path.join(stateRoot, 'locks', 'conversation-binding.lock');
  }

  async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const owner = await this.acquire();
    try {
      return await operation();
    } finally {
      await this.release(owner);
    }
  }

  private async acquire(): Promise<LockOwner> {
    const deadline = Date.now() + this.timeoutMs;
    const owner: LockOwner = {
      pid: process.pid,
      token: randomBytes(16).toString('hex'),
      acquiredAt: new Date().toISOString(),
    };
    await mkdir(path.dirname(this.file), { recursive: true });
    while (Date.now() < deadline) {
      try {
        const handle = await open(this.file, 'wx');
        try {
          await handle.writeFile(JSON.stringify(owner), 'utf8');
        } finally {
          await handle.close();
        }
        return owner;
      } catch (error: any) {
        if (error?.code !== 'EEXIST') throw error;
        await this.recoverDeadOwner();
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    throw new ChatbridgeError(
      'Timed out waiting for the conversation binding lock',
      'CONVERSATION_BINDING_LOCK_TIMEOUT',
    );
  }

  private async recoverDeadOwner(): Promise<void> {
    let age = 0;
    try {
      age = Date.now() - (await stat(this.file)).mtimeMs;
      if (age < 1000) return;
      const raw = await readFile(this.file, 'utf8');
      const owner = JSON.parse(raw) as Partial<LockOwner>;
      if (!Number.isInteger(owner.pid) || typeof owner.token !== 'string')
        throw new ChatbridgeError(
          'Conversation binding lock is malformed',
          'CONVERSATION_BINDING_LOCK_INVALID',
        );
      try {
        process.kill(owner.pid!, 0);
        return;
      } catch (error: any) {
        if (error?.code !== 'ESRCH') return;
      }
      if ((await readFile(this.file, 'utf8')) === raw) await unlink(this.file);
    } catch (error: any) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  }

  private async release(owner: LockOwner): Promise<void> {
    try {
      const current = JSON.parse(await readFile(this.file, 'utf8')) as Partial<LockOwner>;
      if (current.token !== owner.token)
        throw new ChatbridgeError(
          'Conversation binding lock ownership changed',
          'CONVERSATION_BINDING_LOCK_INVALID',
        );
      await unlink(this.file);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}
