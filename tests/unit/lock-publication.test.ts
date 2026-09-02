import { mkdtemp, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { TaskOperationLock } from '../../src/duet/task-operation-lock.js';

const fault = vi.hoisted(() => ({ fail: true, completeOwnerObserved: false }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    link: async (source: string, target: string) => {
      const owner = JSON.parse(await actual.readFile(source, 'utf8'));
      fault.completeOwnerObserved = Number.isInteger(owner.pid) && typeof owner.token === 'string';
      if (fault.fail) {
        fault.fail = false;
        throw new Error('crash before publication');
      }
      return actual.link(source, target);
    },
  };
});

it('a crash before lock publication leaves no torn final lock and permits recovery', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lock-publication-'));
  const lock = new TaskOperationLock(root);
  await expect(lock.withLock('demo', async () => undefined)).rejects.toThrow(
    'crash before publication',
  );
  expect(fault.completeOwnerObserved).toBe(true);
  expect(await readdir(path.join(root, 'locks', 'tasks'))).toEqual([]);
  await expect(lock.withLock('demo', async () => 'recovered')).resolves.toBe('recovered');
});
