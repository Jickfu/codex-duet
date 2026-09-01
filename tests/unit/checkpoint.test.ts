import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TaskCheckpointStore } from '../../src/core/checkpoint.js';

describe('task checkpoint', () => {
  it('atomically persists and restores required task identity', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codex-duet-'));
    const store = new TaskCheckpointStore(root);
    const checkpoint = {
      taskId: '01JTEST',
      mode: 'GITHUB' as const,
      iteration: 2,
      state: 'EXECUTED' as const,
      conversationRef: 'conversation-1',
      baseRef: 'a'.repeat(40),
      reviewRef: 'b'.repeat(40),
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(1).toISOString(),
    };
    await store.write(checkpoint);
    expect(await store.read('01JTEST')).toEqual(checkpoint);
    expect(
      JSON.parse(await readFile(path.join(root, 'tasks', '01JTEST.json'), 'utf8')).reviewRef,
    ).toBe('b'.repeat(40));
  });

  it('rejects path-like task IDs', async () => {
    const store = new TaskCheckpointStore(await mkdtemp(path.join(tmpdir(), 'codex-duet-')));
    await expect(store.read('../escape')).rejects.toThrow(/Invalid task ID/);
  });
});
