import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DuetRunStore } from '../../src/duet/run-store.js';
import {
  DuetRunCheckpointV2Schema,
  type DuetRunCheckpointV1,
  type DuetRunCheckpointV2,
} from '../../src/duet/run.js';

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
const plan = { sha256: 'c'.repeat(64) };
const reviewTarget = {
  mode: 'GITHUB' as const,
  repository: 'owner/repo',
  remote: 'origin',
  taskId: 'demo',
  taskBranch: 'agent/task-demo',
  baseRef: 'a'.repeat(40),
  reviewRef: 'd'.repeat(40),
  testStatus: 'PASS' as const,
};
function checkpointInState(state: DuetRunCheckpointV1['state']): DuetRunCheckpointV1 {
  const value = checkpoint();
  return {
    ...value,
    state,
    ...(['PLAN', 'EXECUTING', 'EXECUTED', 'REVIEWING', 'DONE'].includes(state) ? { plan } : {}),
    ...(['EXECUTED', 'REVIEWING', 'DONE'].includes(state) ? { reviewTarget } : {}),
    ...(state === 'BLOCKED' ? { blockedPhase: 'PLANNING' as const } : {}),
  } as DuetRunCheckpointV1;
}
function v2(): DuetRunCheckpointV2 {
  const now = new Date().toISOString();
  return DuetRunCheckpointV2Schema.parse({
    version: 2,
    taskId: 'demo',
    mode: 'GITHUB',
    iteration: 1,
    state: 'PLAN',
    context: checkpoint().context,
    request: checkpoint().request,
    iterations: [{ iteration: 1, plan }],
    limits: { maxIterations: 8 },
    createdAt: now,
    updatedAt: now,
  });
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
  it('rejects invalid iteration artifact paths', async () => {
    const store = new DuetRunStore(await root());
    await expect(store.writeIterationArtifact('demo', 0, 'plan.md', 'x')).rejects.toMatchObject({
      code: 'INVALID_ITERATION',
    });
    expect(() => store.iterationArtifactPath('demo', 1.5, 'plan.md')).toThrow();
  });
  it('stores artifacts under the project-scoped run directory', async () => {
    const stateRoot = await root();
    const store = new DuetRunStore(stateRoot);
    await store.writeRequestArtifact('demo', 'request');
    expect(await readFile(path.join(stateRoot, 'runs', 'demo', 'request.md'), 'utf8')).toBe(
      'request',
    );
  });
  it('creates or verifies immutable control artifacts without overwriting divergence', async () => {
    const stateRoot = await root();
    const store = new DuetRunStore(stateRoot);
    await store.createOrVerifyIterationArtifact('demo', 1, 'planner-control.txt', 'planner');
    const file = store.iterationArtifactPath('demo', 1, 'planner-control.txt');
    await expect(
      store.createOrVerifyIterationArtifact('demo', 1, 'planner-control.txt', 'planner'),
    ).resolves.toBeUndefined();
    await expect(
      store.createOrVerifyIterationArtifact('demo', 1, 'planner-control.txt', 'different'),
    ).rejects.toMatchObject({ code: 'CONTROL_ARTIFACT_IMMUTABLE' });
    expect(await readFile(file, 'utf8')).toBe('planner');
  });
  it.each(['PLANNING', 'PLAN', 'EXECUTING', 'EXECUTED', 'REVIEWING', 'DONE', 'BLOCKED'] as const)(
    'reads a real V1 %s checkpoint without mutation',
    async (state) => {
      const stateRoot = await root();
      const store = new DuetRunStore(stateRoot);
      await store.write(checkpointInState(state));
      expect(await store.read('demo')).toMatchObject({ version: 1, state });
      expect(
        JSON.parse(await readFile(path.join(stateRoot, 'runs', 'demo.json'), 'utf8')),
      ).toMatchObject({
        version: 1,
        state,
      });
    },
  );
  it('migrates V1 atomically, preserves legacy artifacts, and is idempotent', async () => {
    const stateRoot = await root();
    const store = new DuetRunStore(stateRoot);
    await store.write(checkpointInState('REVIEWING'));
    const runDirectory = path.join(stateRoot, 'runs', 'demo');
    await mkdir(runDirectory, { recursive: true });
    await writeFile(path.join(runDirectory, 'plan.md'), 'legacy plan', 'utf8');
    await writeFile(path.join(runDirectory, 'review-envelope.txt'), 'legacy review', 'utf8');

    const migrated = await store.migrate('demo');
    expect(migrated).toMatchObject({
      version: 2,
      state: 'REVIEWING',
      limits: { maxIterations: 8 },
      iterations: [{ iteration: 1, plan, reviewTarget }],
    });
    expect(await readFile(path.join(runDirectory, 'plan.md'), 'utf8')).toBe('legacy plan');
    expect(await readFile(path.join(runDirectory, 'review-envelope.txt'), 'utf8')).toBe(
      'legacy review',
    );
    expect(await readFile(store.iterationArtifactPath('demo', 1, 'plan.md'), 'utf8')).toBe(
      'legacy plan',
    );
    expect(
      await readFile(store.iterationArtifactPath('demo', 1, 'review-envelope.txt'), 'utf8'),
    ).toBe('legacy review');
    expect(await store.migrate('demo')).toEqual(migrated);
    expect(
      (await readdir(path.join(stateRoot, 'runs'))).some((name) => name.endsWith('.tmp')),
    ).toBe(false);
  });
  it('migrates a stopped M3.0 PLAN 2 without misassigning the prior review target', async () => {
    const stateRoot = await root();
    const store = new DuetRunStore(stateRoot);
    await store.write({
      ...checkpointInState('PLAN'),
      iteration: 2,
      reviewTarget,
    });
    expect(await store.migrate('demo')).toMatchObject({
      version: 2,
      iteration: 2,
      state: 'PLAN',
      iterations: [
        {
          iteration: 1,
          plan: { legacyEvidenceUnavailable: true },
          reviewTarget,
        },
        { iteration: 2, plan },
      ],
    });
  });
  it.each([
    { iterations: [{ iteration: 2, plan }] },
    {
      iterations: [
        { iteration: 1, plan },
        { iteration: 1, plan },
      ],
      iteration: 2,
    },
    {
      iterations: [
        { iteration: 1, plan },
        { iteration: 3, plan },
      ],
      iteration: 2,
    },
    { state: 'REVIEWING' },
    { state: 'DONE' },
    { unexpected: true },
    { context: { ...checkpoint().context, taskId: 'other' } },
  ])('rejects invalid V2 history and state consistency', async (override) => {
    const store = new DuetRunStore(await root());
    await expect(store.write({ ...v2(), ...override } as DuetRunCheckpointV2)).rejects.toThrow();
  });
});
