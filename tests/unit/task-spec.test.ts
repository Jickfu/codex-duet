import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  canonicalJson,
  serializeTaskSpec,
  sha256,
  taskSpecFingerprint,
  TaskSpecV1Schema,
  validateTaskSpecCandidate,
  type TaskSpecV1,
  type TaskSpecWithoutIntegrity,
} from '../../src/duet/task-spec.js';
import { TaskSpecStore } from '../../src/duet/task-spec-store.js';

const roots: string[] = [];
const rawRequest = 'Add exact-name without changing existing behavior.';

function content(overrides: Partial<TaskSpecWithoutIntegrity> = {}): TaskSpecWithoutIntegrity {
  return {
    version: 1,
    taskId: 'demo',
    mode: 'GITHUB',
    objective: 'Add a compact task specification.',
    scope: { allowed: ['src/duet'], forbidden: ['C2C/2'] },
    acceptanceCriteria: [{ id: 'a1', requirement: 'Preserve compatibility', priority: 'MUST' }],
    exactLiterals: [
      { id: 'l1', value: 'exact-name', usage: 'Required output', caseSensitive: true },
    ],
    protocolRequirements: [
      {
        id: 'p1',
        requirement: 'Never replay an ambiguous send',
        replaySafety: 'NON_IDEMPOTENT',
      },
    ],
    context: {
      repository: 'owner/repo',
      taskBranch: 'agent/task-demo',
      baseRef: 'a'.repeat(40),
    },
    source: { rawRequestSha256: sha256(rawRequest) },
    contracts: {
      plannerPath: 'docs/contracts/planner-v1.md',
      reviewerPath: 'docs/contracts/reviewer-v1.md',
      resolution: 'AT_BASE_REF',
    },
    ...overrides,
  };
}

function candidate(overrides: Partial<TaskSpecWithoutIntegrity> = {}): TaskSpecV1 {
  const value = content(overrides);
  return { ...value, integrity: { sha256: taskSpecFingerprint(value) } };
}

function validate(value: unknown, request = rawRequest) {
  return validateTaskSpecCandidate(value, {
    taskId: 'demo',
    mode: 'GITHUB',
    rawRequest: request,
    context: {
      repository: 'owner/repo',
      taskBranch: 'agent/task-demo',
      baseRef: 'a'.repeat(40),
    },
  });
}

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe('TaskSpecV1', () => {
  it('uses a strict minimal schema', () => {
    expect(TaskSpecV1Schema.parse(candidate())).toMatchObject({ version: 1, taskId: 'demo' });
    expect(() => TaskSpecV1Schema.parse({ ...candidate(), unexpected: true })).toThrow();
  });

  it('rejects invalid task identity, mode, request SHA, and GitHub context', () => {
    expect(() => validate(candidate({ taskId: '../escape' }))).toThrow();
    expectCode(() => validate(candidate({ taskId: 'other' })), 'TASK_SPEC_TASK_MISMATCH');
    expectCode(() => validate(candidate({ mode: 'LOCAL' })), 'TASK_SPEC_MODE_MISMATCH');
    expectCode(() => validate(candidate(), 'different request'), 'TASK_SPEC_REQUEST_MISMATCH');
    expectCode(
      () => validate(candidate({ context: { ...content().context, repository: 'other/repo' } })),
      'TASK_SPEC_CONTEXT_MISMATCH',
    );
  });

  it('preserves raw exact literals and permits explicit system-generated literals', () => {
    expect(validate(candidate()).exactLiterals[0]?.value).toBe('exact-name');
    const mismatch = candidate({
      exactLiterals: [
        { id: 'missing', value: 'not present', usage: 'Required output', caseSensitive: true },
      ],
    });
    expectCode(() => validate(mismatch), 'TASK_SPEC_LITERAL_MISMATCH');
    expect(() =>
      validate(
        candidate({
          exactLiterals: [
            {
              id: 'generated',
              value: 'agent/task-demo',
              usage: 'SYSTEM_GENERATED: durable task branch',
              caseSensitive: true,
            },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('has deterministic key-sorted canonical hashing', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe('{"a":{"b":3,"y":2},"z":1}');
    const first = content();
    const reordered = JSON.parse(JSON.stringify(first)) as TaskSpecWithoutIntegrity;
    expect(taskSpecFingerprint(first)).toBe(taskSpecFingerprint(reordered));
    expectCode(
      () => validate({ ...candidate(), integrity: { sha256: '0'.repeat(64) } }),
      'TASK_SPEC_INTEGRITY_INVALID',
    );
  });

  it('atomically creates canonical local state and never overwrites it', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'task-spec-'));
    roots.push(root);
    const store = new TaskSpecStore(path.join(root, '.chatbridge'));
    const spec = candidate();
    await store.createOrVerify(spec);
    expect(await store.read('demo')).toEqual(spec);
    expect(await readFile(store.pathFor('demo'), 'utf8')).toBe(serializeTaskSpec(spec));
    const originalBytes = await readFile(store.pathFor('demo'), 'utf8');
    await expect(store.createOrVerify(spec)).resolves.toBeUndefined();
    expect(await readFile(store.pathFor('demo'), 'utf8')).toBe(originalBytes);
    const different = candidate({ objective: 'Different immutable semantics' });
    await expect(store.createOrVerify(different)).rejects.toMatchObject({
      code: 'TASK_SPEC_IMMUTABLE',
    });
    expect(await readFile(store.pathFor('demo'), 'utf8')).toBe(originalBytes);
    expect((await readdir(path.dirname(store.pathFor('demo')))).sort()).toEqual(['task-spec.json']);
    expect(store.pathFor('demo')).toContain(path.join('.chatbridge', 'runs', 'demo'));
    await writeFile(
      store.pathFor('demo'),
      serializeTaskSpec({ ...spec, objective: 'tampered but schema-valid' }),
      'utf8',
    );
    await expect(store.read('demo')).rejects.toMatchObject({ code: 'TASK_SPEC_INTEGRITY_INVALID' });
  });
});
