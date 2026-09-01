import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionStore, TaskCheckpointStore } from '../../src/core/checkpoint.js';

describe('task checkpoint', () => {
  it('atomically persists and restores required task identity', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codex-duet-'));
    const store = new TaskCheckpointStore(root);
    const checkpoint = {
      version: 1 as const,
      taskId: '01JTEST',
      mode: 'GITHUB' as const,
      iteration: 2,
      state: 'EXECUTED' as const,
      conversationRef: 'conversation-1',
      repository: 'owner/repository',
      remote: 'origin',
      taskBranch: 'agent/task-01JTEST',
      baseRef: 'a'.repeat(40),
      reviewRef: 'b'.repeat(40),
      testStatus: 'PASS' as const,
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

describe('browser send checkpoint', () => {
  it('persists the versioned causal marker without message content', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codex-duet-session-'));
    const store = new SessionStore(root);
    const value = {
      version: 2 as const,
      conversationUrl: 'https://chatgpt.com/c/test',
      outgoingUserMessageId: 'user-id_1',
      previousAssistantMessageId: 'assistant-id_1',
      sentAt: new Date().toISOString(),
    };
    await store.write(value);
    expect(await store.read()).toEqual(value);
    expect(await readFile(path.join(root, 'session.json'), 'utf8')).not.toContain('prompt');
  });

  it('rejects a legacy assistant-count checkpoint with a migration error', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codex-duet-session-'));
    await mkdir(root, { recursive: true });
    await writeFile(
      path.join(root, 'session.json'),
      JSON.stringify({ assistantCount: 3, sentAt: new Date().toISOString() }),
    );
    await expect(new SessionStore(root).read()).rejects.toMatchObject({
      code: 'STALE_SEND_CHECKPOINT',
    });
  });
});
