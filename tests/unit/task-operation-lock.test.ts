import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskOperationLock } from '../../src/duet/task-operation-lock.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true }))));

describe('TaskOperationLock', () => {
  it('serializes the same task across independent lock instances and releases in finally', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'task-lock-'));
    roots.push(root);
    const first = new TaskOperationLock(root, 2000);
    const second = new TaskOperationLock(root, 2000);
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const a = first.withLock('demo', async () => {
      events.push('a:start');
      await gate;
      events.push('a:end');
    });
    while (!events.length) await new Promise((resolve) => setTimeout(resolve, 5));
    const b = second.withLock('demo', async () => events.push('b'));
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(events).toEqual(['a:start']);
    release();
    await Promise.all([a, b]);
    expect(events).toEqual(['a:start', 'a:end', 'b']);
    await expect(
      first.withLock('demo', async () => {
        throw new Error('failure');
      }),
    ).rejects.toThrow('failure');
    await expect(second.withLock('demo', async () => 'released')).resolves.toBe('released');
  });
});
