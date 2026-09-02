import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  TaskContextStore,
  TaskContextV1Schema,
  type TaskContextV1,
} from '../../src/duet/task-context-store.js';

const roots: string[] = [];
const context: TaskContextV1 = {
  version: 1,
  taskId: 'demo',
  taskSpecSha256: 'a'.repeat(64),
  plannerControlSha256: 'b'.repeat(64),
};

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe('TaskContextStore', () => {
  it('uses a strict path-safe schema', async () => {
    expect(TaskContextV1Schema.parse(context)).toEqual(context);
    expect(() => TaskContextV1Schema.parse({ ...context, extra: true })).toThrow();
    const root = await mkdtemp(path.join(os.tmpdir(), 'task-context-'));
    roots.push(root);
    expect(() => new TaskContextStore(root).pathFor('../escape')).toThrow();
  });

  it('atomically creates or verifies identical evidence and rejects divergence', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'task-context-'));
    roots.push(root);
    const store = new TaskContextStore(path.join(root, '.chatbridge'));
    await store.createOrVerify(context);
    const original = await readFile(store.pathFor('demo'), 'utf8');
    await expect(store.createOrVerify(context)).resolves.toBeUndefined();
    expect(await readFile(store.pathFor('demo'), 'utf8')).toBe(original);
    await expect(
      store.createOrVerify({ ...context, plannerControlSha256: 'c'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'TASK_CONTEXT_IMMUTABLE' });
    expect(await readFile(store.pathFor('demo'), 'utf8')).toBe(original);
    expect(await store.read('demo')).toEqual(context);
  });
});
