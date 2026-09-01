import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DuetRunStore } from '../../src/duet/run-store.js';
import type { DuetRunCheckpointV1 } from '../../src/duet/run.js';

const roots: string[] = [];
async function root(): Promise<string> {
  const value = await mkdtemp(path.join(os.tmpdir(), 'duet-store-'));
  roots.push(value);
  return value;
}
function checkpoint(taskId = 'demo'): DuetRunCheckpointV1 {
  const now = new Date().toISOString();
  return {
    version: 1,
    taskId,
    mode: 'GITHUB',
    iteration: 1,
    state: 'PLANNING',
    context: {
      mode: 'GITHUB',
      repository: 'owner/repo',
      remote: 'origin',
      taskId,
      taskBranch: `agent/task-${taskId}`,
      baseRef: 'a'.repeat(40),
    },
    request: { sha256: 'b'.repeat(64) },
    createdAt: now,
    updatedAt: now,
  };
}
afterEach(async () =>
  Promise.all(roots.splice(0).map((item) => rm(item, { recursive: true, force: true }))),
);

describe('DuetRunStore', () => {
  it('persists a valid versioned run atomically', async () => {
    const stateRoot = await root();
    const store = new DuetRunStore(stateRoot);
    await store.write(checkpoint());
    expect(await store.read('demo')).toMatchObject({ version: 1, state: 'PLANNING' });
    expect(await readdir(path.join(stateRoot, 'runs'))).toEqual(['demo.json']);
  });
  it('rejects malformed durable state', async () => {
    const stateRoot = await root();
    const file = path.join(stateRoot, 'runs', 'demo.json');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ version: 99 }), 'utf8');
    await expect(new DuetRunStore(stateRoot).read('demo')).rejects.toThrow();
  });
  it('rejects traversal in task paths', async () => {
    await expect(new DuetRunStore(await root()).read('../escape')).rejects.toMatchObject({
      code: 'INVALID_TASK_ID',
    });
  });
  it('stores artifacts under the project-scoped run directory', async () => {
    const stateRoot = await root();
    const store = new DuetRunStore(stateRoot);
    await store.writeArtifact('demo', 'request.md', 'request');
    expect(await readFile(path.join(stateRoot, 'runs', 'demo', 'request.md'), 'utf8')).toBe(
      'request',
    );
  });
});
