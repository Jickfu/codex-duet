import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExecutionStore } from '../../src/duet/execution-store.js';

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'execution-store-'));
  roots.push(root);
  return { root, store: new ExecutionStore(root) };
}
const checkpoint = (iteration = 1) => ({
  version: 1 as const,
  taskId: 'demo',
  iteration,
  planSha256: 'a'.repeat(64),
  baseline: { taskBranch: 'agent/task-demo', head: 'b'.repeat(40) },
  startedAt: new Date(0).toISOString(),
});

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true }))));

describe('ExecutionStore', () => {
  it('writes strict iteration-scoped checkpoints atomically and replaces only tests', async () => {
    const { root, store } = await fixture();
    await store.write(checkpoint(1));
    await store.write(checkpoint(2));
    const updated = {
      ...checkpoint(1),
      tests: {
        status: 'PASS' as const,
        head: 'c'.repeat(40),
        recordedAt: new Date(1).toISOString(),
      },
    };
    await store.write(updated);
    expect(await store.read('demo', 1)).toEqual(updated);
    expect(await store.read('demo', 2)).toEqual(checkpoint(2));
    const directory = path.dirname(store.checkpointPath('demo', 1));
    expect(await readdir(directory)).toEqual(['execution.json']);
    expect(await readFile(store.checkpointPath('demo', 1), 'utf8')).not.toMatch(
      /source|diffBody|stdout|stderr|environment|secret/,
    );
    expect(root).toBeTruthy();
  });

  it.each([
    [{ ...checkpoint(), extra: true }],
    [{ ...checkpoint(), taskId: '../bad' }],
    [{ ...checkpoint(), iteration: 0 }],
    [{ ...checkpoint(), baseline: { ...checkpoint().baseline, head: 'short' } }],
  ])('rejects invalid checkpoint %j', async (value) => {
    const { store } = await fixture();
    await expect(store.write(value as never)).rejects.toThrow();
  });

  it('classifies malformed durable JSON without rewriting it', async () => {
    const { store } = await fixture();
    const file = store.checkpointPath('demo', 1);
    await store.write(checkpoint());
    await writeFile(file, '{"version":1,"unexpected":true}', 'utf8');
    await expect(store.read('demo', 1)).rejects.toMatchObject({
      code: 'EXECUTION_CHECKPOINT_INVALID',
    });
  });
});
