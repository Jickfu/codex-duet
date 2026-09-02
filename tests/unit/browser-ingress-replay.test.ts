import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { afterEach, expect, it, vi } from 'vitest';
import { duetIngest } from '../../src/cli/duet.js';
import { DuetRunStore } from '../../src/duet/run-store.js';
import { serializeEnvelope } from '../../src/core/protocol.js';

afterEach(() => vi.restoreAllMocks());

it('replays the Browser response after PLAN without seeking a reviewer artifact', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-ingress-'));
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const store = new DuetRunStore(path.join(root, '.chatbridge'));
  const context = {
    mode: 'GITHUB' as const,
    taskId: 'demo',
    repository: 'owner/repo',
    remote: 'origin',
    taskBranch: 'agent/task-demo',
    baseRef: 'a'.repeat(40),
  };
  await store.write({
    version: 2,
    mode: 'GITHUB',
    taskId: 'demo',
    iteration: 1,
    state: 'PLANNING',
    context,
    request: { sha256: 'b'.repeat(64) },
    iterations: [],
    limits: { maxIterations: 8 },
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
  });
  await store.writeIterationArtifact('demo', 1, 'planner-control.txt', 'original control');
  const responseFile = path.join(root, 'response.txt');
  await writeFile(
    responseFile,
    serializeEnvelope({
      version: 1,
      taskId: 'demo',
      iteration: 1,
      state: 'PLAN',
      mode: 'GITHUB',
      repository: context.repository,
      taskBranch: context.taskBranch,
      baseRef: context.baseRef,
      content: 'plan',
    }),
  );
  await duetIngest('demo', responseFile);
  expect((await store.read('demo'))?.state).toBe('PLAN');
  await duetIngest('demo', responseFile);
  expect(JSON.parse(output.mock.calls.at(-1)![0] as string).disposition).toBe('REPLAY');
});
