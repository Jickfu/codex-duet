import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TestStatus } from '../../src/core/domain.js';
import { serializeEnvelope, type Envelope } from '../../src/core/protocol.js';
import { DuetOrchestrator } from '../../src/duet/orchestrator.js';
import { DuetRunStore } from '../../src/duet/run-store.js';
import type { DuetRunCheckpointV1 } from '../../src/duet/run.js';
import type { GitHubContextRef, GitHubReviewTarget } from '../../src/providers/code-provider.js';
import {
  sha256,
  taskSpecFingerprint,
  type TaskSpecWithoutIntegrity,
} from '../../src/duet/task-spec.js';
import { TaskSpecStore } from '../../src/duet/task-spec-store.js';

let temporary: string;
let requestFile: string;
let outputFile: string;
let responseFile: string;
let taskSpecFile: string;
let store: DuetRunStore;
let provider: {
  prepareContext: ReturnType<typeof vi.fn<(taskId: string) => Promise<GitHubContextRef>>>;
  getReviewTarget: ReturnType<
    typeof vi.fn<(taskId: string, tests: TestStatus) => Promise<GitHubReviewTarget>>
  >;
};
let duet: DuetOrchestrator;
let historyVerifier: {
  isAncestor: ReturnType<typeof vi.fn<(a: string, b: string) => Promise<boolean>>>;
};
const context: GitHubContextRef = {
  mode: 'GITHUB',
  repository: 'owner/repo',
  remote: 'origin',
  taskId: 'demo',
  taskBranch: 'agent/task-demo',
  baseRef: 'a'.repeat(40),
};
const target: GitHubReviewTarget = { ...context, reviewRef: 'b'.repeat(40), testStatus: 'PASS' };
const target2: GitHubReviewTarget = { ...context, reviewRef: 'c'.repeat(40), testStatus: 'PASS' };
const target3: GitHubReviewTarget = { ...context, reviewRef: 'd'.repeat(40), testStatus: 'PASS' };

beforeEach(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), 'duet-orchestrator-'));
  requestFile = path.join(temporary, 'request.md');
  outputFile = path.join(temporary, 'out.txt');
  responseFile = path.join(temporary, 'response.txt');
  taskSpecFile = path.join(temporary, 'task-spec-input.json');
  await writeFile(requestFile, 'Add a harmless document.', 'utf8');
  store = new DuetRunStore(path.join(temporary, '.chatbridge'));
  provider = {
    prepareContext: vi.fn(async () => context),
    getReviewTarget: vi.fn(async () => target),
  };
  historyVerifier = { isAncestor: vi.fn(async () => true) };
  duet = new DuetOrchestrator(provider as never, store, historyVerifier);
});
afterEach(async () => rm(temporary, { recursive: true, force: true }));
async function init() {
  await duet.init('demo', requestFile, outputFile);
}
async function respond(
  state: 'PLAN' | 'BLOCKED' | 'FAILED' | 'DONE',
  iteration = 1,
  overrides: Record<string, unknown> = {},
  format: 'raw' | 'json' = 'raw',
) {
  const currentRun = await store.read('demo');
  const currentReview =
    currentRun?.version === 2 && currentRun.state === 'REVIEWING'
      ? currentRun.iterations[currentRun.iteration - 1]?.reviewTarget
      : undefined;
  const envelope = {
    version: 1,
    taskId: 'demo',
    iteration,
    state,
    mode: 'GITHUB',
    repository: context.repository,
    taskBranch: context.taskBranch,
    baseRef: context.baseRef,
    ...(currentReview
      ? { reviewRef: currentReview.reviewRef, testStatus: currentReview.testStatus }
      : {}),
    content: `${state} content`,
    ...overrides,
  } as Envelope;
  await writeFile(
    responseFile,
    format === 'raw' ? serializeEnvelope(envelope) : JSON.stringify(envelope, null, 2),
    'utf8',
  );
}
async function reachReviewing() {
  await init();
  await respond('PLAN');
  await duet.ingest('demo', responseFile);
  await duet.beginExecution('demo');
  await duet.prepareReview('demo', 'PASS', outputFile);
  await duet.markReviewing('demo');
}

describe('DuetOrchestrator', () => {
  it('validates and persists a normalized TaskSpec supplied by Codex', async () => {
    const taskSpecContent: TaskSpecWithoutIntegrity = {
      version: 1,
      taskId: 'demo',
      mode: 'GITHUB',
      objective: 'Add a harmless document.',
      scope: { allowed: ['docs'], forbidden: ['src'] },
      acceptanceCriteria: [
        { id: 'must-1', requirement: 'Add the requested document', priority: 'MUST' },
      ],
      exactLiterals: [
        {
          id: 'literal-1',
          value: 'harmless document',
          usage: 'User wording',
          caseSensitive: true,
        },
      ],
      protocolRequirements: [],
      context: {
        repository: context.repository,
        taskBranch: context.taskBranch,
        baseRef: context.baseRef,
      },
      source: { rawRequestSha256: sha256('Add a harmless document.') },
      contracts: {
        plannerPath: 'docs/contracts/planner-v1.md',
        reviewerPath: 'docs/contracts/reviewer-v1.md',
        resolution: 'AT_BASE_REF',
      },
    };
    const taskSpec = {
      ...taskSpecContent,
      integrity: { sha256: taskSpecFingerprint(taskSpecContent) },
    };
    await writeFile(taskSpecFile, JSON.stringify(taskSpec), 'utf8');
    const taskSpecs = new TaskSpecStore(path.join(temporary, '.chatbridge'));
    const compactDuet = new DuetOrchestrator(
      provider as never,
      store,
      historyVerifier,
      undefined,
      taskSpecs,
    );
    await compactDuet.init('demo', requestFile, outputFile, 8, taskSpecFile);
    expect(await taskSpecs.read('demo')).toEqual(taskSpec);
    expect(await readFile(store.requestArtifactPath('demo'), 'utf8')).toBe(
      'Add a harmless document.',
    );
  });

  it('initializes PLANNING once and writes a compact envelope', async () => {
    const run = await duet.init('demo', requestFile, outputFile);
    expect(run).toMatchObject({
      version: 2,
      iteration: 1,
      iterations: [],
      limits: { maxIterations: 8 },
    });
    expect(run.state).toBe('PLANNING');
    expect(provider.prepareContext).toHaveBeenCalledWith('demo');
    expect(await readFile(outputFile, 'utf8')).toContain('STATE: PLANNING');
    expect(await readFile(outputFile, 'utf8')).toContain(
      'Your response must echo TASK, MODE, REPOSITORY, TASK_BRANCH, and BASE_REF exactly',
    );
    await expect(duet.init('demo', requestFile, outputFile)).rejects.toMatchObject({
      code: 'RUN_ALREADY_EXISTS',
    });
  });
  it('validates and persists a custom maxIterations', async () => {
    expect(await duet.init('demo', requestFile, outputFile, 2)).toMatchObject({
      limits: { maxIterations: 2 },
    });
    for (const invalid of [0, 101, 1.5, Number.NaN]) {
      const isolated = new DuetOrchestrator(
        provider as never,
        new DuetRunStore(path.join(temporary, `invalid-${String(invalid)}`)),
        historyVerifier,
      );
      await expect(isolated.init('demo', requestFile, outputFile, invalid)).rejects.toMatchObject({
        code: 'INVALID_MAX_ITERATIONS',
      });
    }
  });
  it('moves PLAN through EXECUTING and composes the frozen provider for EXECUTED', async () => {
    await init();
    await respond('PLAN');
    expect((await duet.ingest('demo', responseFile)).state).toBe('PLAN');
    expect((await duet.beginExecution('demo')).state).toBe('EXECUTING');
    const executed = await duet.prepareReview('demo', 'PASS', outputFile);
    expect(provider.getReviewTarget).toHaveBeenCalledWith('demo', 'PASS');
    expect(executed.iterations[0]?.reviewTarget).toEqual(target);
    expect(executed.state).toBe('EXECUTED');
    expect(await readFile(outputFile, 'utf8')).toContain(
      'Your C2C response must echo MODE, REPOSITORY, TASK_BRANCH, BASE_REF, REVIEW_REF, and TEST_STATUS exactly.',
    );
    expect((await duet.markReviewing('demo')).state).toBe('REVIEWING');
  });
  it('ingests raw C2C and parsed Envelope JSON with identical PLAN results', async () => {
    await init();
    await respond('PLAN');
    const raw = await duet.ingest('demo', responseFile);

    const jsonStore = new DuetRunStore(path.join(temporary, '.chatbridge-json'));
    const jsonDuet = new DuetOrchestrator(provider as never, jsonStore, historyVerifier);
    await jsonDuet.init('demo', requestFile, outputFile);
    await respond('PLAN', 1, {}, 'json');
    const json = await jsonDuet.ingest('demo', responseFile);

    expect(json).toMatchObject({
      state: raw.state,
      iteration: raw.iteration,
      iterations: raw.iterations,
    });
    expect(await readFile(jsonStore.iterationArtifactPath('demo', 1, 'plan.md'), 'utf8')).toBe(
      await readFile(store.iterationArtifactPath('demo', 1, 'plan.md'), 'utf8'),
    );
  });
  it.each([
    ['mode', undefined, 'MODE_MISMATCH'],
    ['repository', undefined, 'C2C_REPOSITORY_MISMATCH'],
    ['repository', 'other/repo', 'C2C_REPOSITORY_MISMATCH'],
    ['taskBranch', undefined, 'C2C_TASK_BRANCH_MISMATCH'],
    ['taskBranch', 'agent/task-other', 'C2C_TASK_BRANCH_MISMATCH'],
    ['baseRef', undefined, 'C2C_BASE_REF_MISMATCH'],
    ['baseRef', 'e'.repeat(40), 'C2C_BASE_REF_MISMATCH'],
  ])('rejects PLANNING response identity %s=%s before mutation', async (field, value, code) => {
    await init();
    await respond('PLAN', 1, { [field]: value });
    await expect(duet.ingest('demo', responseFile)).rejects.toMatchObject({ code });
    expect(await store.read('demo')).toMatchObject({
      state: 'PLANNING',
      iteration: 1,
      iterations: [],
    });
    await expect(
      readFile(store.iterationArtifactPath('demo', 1, 'plan.md'), 'utf8'),
    ).rejects.toThrow();
  });
  it('applies identical missing-context rejection to parsed JSON', async () => {
    await init();
    await respond('PLAN', 1, { repository: undefined }, 'json');
    await expect(duet.ingest('demo', responseFile)).rejects.toMatchObject({
      code: 'C2C_REPOSITORY_MISMATCH',
    });
    expect(await store.read('demo')).toMatchObject({ state: 'PLANNING', iterations: [] });
  });
  it.each(['PLANNING', 'REVIEWING'] as const)('accepts BLOCKED from %s', async (phase) => {
    if (phase === 'PLANNING') await init();
    else await reachReviewing();
    await respond('BLOCKED');
    expect(await duet.ingest('demo', responseFile)).toMatchObject({
      state: 'BLOCKED',
      blockedPhase: phase,
    });
  });
  it('accepts DONE from REVIEWING', async () => {
    await reachReviewing();
    await respond('DONE');
    expect((await duet.ingest('demo', responseFile)).state).toBe('DONE');
  });
  it.each([
    ['mode', undefined, 'MODE_MISMATCH'],
    ['mode', 'LOCAL', 'MODE_MISMATCH'],
    ['reviewRef', undefined, 'C2C_REVIEW_REF_MISMATCH'],
    ['reviewRef', 'e'.repeat(40), 'C2C_REVIEW_REF_MISMATCH'],
    ['testStatus', undefined, 'C2C_TEST_STATUS_MISMATCH'],
    ['testStatus', 'FAIL', 'C2C_TEST_STATUS_MISMATCH'],
    ['repository', undefined, 'C2C_REPOSITORY_MISMATCH'],
    ['repository', 'other/repo', 'C2C_REPOSITORY_MISMATCH'],
    ['taskBranch', undefined, 'C2C_TASK_BRANCH_MISMATCH'],
    ['taskBranch', 'agent/task-other', 'C2C_TASK_BRANCH_MISMATCH'],
    ['baseRef', undefined, 'C2C_BASE_REF_MISMATCH'],
    ['baseRef', 'e'.repeat(40), 'C2C_BASE_REF_MISMATCH'],
  ])('rejects REVIEWING response identity %s=%s before mutation', async (field, value, code) => {
    await reachReviewing();
    await respond('DONE', 1, { [field]: value });
    await expect(duet.ingest('demo', responseFile)).rejects.toMatchObject({ code });
    expect(await store.read('demo')).toMatchObject({ state: 'REVIEWING', iteration: 1 });
  });
  it.each([
    ['DONE', 1],
    ['BLOCKED', 1],
    ['FAILED', 1],
    ['PLAN', 2],
  ] as const)('accepts reviewer %s as parsed Envelope JSON', async (state, iteration) => {
    await reachReviewing();
    await respond(state, iteration, {}, 'json');
    expect(await duet.ingest('demo', responseFile)).toMatchObject({ state, iteration });
  });
  it('persists reviewer PLAN as the next iteration', async () => {
    await reachReviewing();
    await respond('PLAN', 2);
    expect(await duet.ingest('demo', responseFile)).toMatchObject({ state: 'PLAN', iteration: 2 });
  });
  it('requires next-iteration PLAN to identify the review just completed', async () => {
    await reachReviewing();
    await respond('PLAN', 2, { reviewRef: target.reviewRef, testStatus: target.testStatus });
    expect(await duet.ingest('demo', responseFile)).toMatchObject({ state: 'PLAN', iteration: 2 });
  });
  it('rejects a future review ref guessed by next-iteration PLAN', async () => {
    await reachReviewing();
    await respond('PLAN', 2, { reviewRef: target2.reviewRef });
    await expect(duet.ingest('demo', responseFile)).rejects.toMatchObject({
      code: 'C2C_REVIEW_REF_MISMATCH',
    });
    expect(await store.read('demo')).toMatchObject({ state: 'REVIEWING', iteration: 1 });
  });
  it.each([
    ['PLANNING', 'BLOCKED', 'repository', undefined, 'C2C_REPOSITORY_MISMATCH'],
    ['PLANNING', 'FAILED', 'baseRef', undefined, 'C2C_BASE_REF_MISMATCH'],
    ['REVIEWING', 'BLOCKED', 'reviewRef', undefined, 'C2C_REVIEW_REF_MISMATCH'],
    ['REVIEWING', 'FAILED', 'testStatus', undefined, 'C2C_TEST_STATUS_MISMATCH'],
  ] as const)(
    'does not let %s %s bypass identity validation',
    async (phase, state, field, value, code) => {
      if (phase === 'PLANNING') await init();
      else await reachReviewing();
      await respond(state, 1, { [field]: value });
      await expect(duet.ingest('demo', responseFile)).rejects.toMatchObject({ code });
      expect(await store.read('demo')).toMatchObject({ state: phase });
    },
  );
  it('preserves three iterations, artifacts, and cumulative review identity', async () => {
    await init();
    await respond('PLAN');
    await duet.ingest('demo', responseFile);
    await duet.beginExecution('demo');
    await duet.prepareReview('demo', 'PASS', outputFile);
    await duet.markReviewing('demo');

    await respond('PLAN', 2, { content: 'Fix finding two' });
    await duet.ingest('demo', responseFile);
    await duet.beginExecution('demo');
    provider.getReviewTarget.mockResolvedValueOnce(target2);
    const second = await duet.prepareReview('demo', 'PASS', outputFile);
    expect(second.context.baseRef).toBe(context.baseRef);
    expect(second.iterations.map((record) => record.reviewTarget?.reviewRef)).toEqual([
      target.reviewRef,
      target2.reviewRef,
    ]);
    expect(historyVerifier.isAncestor).toHaveBeenCalledWith(target.reviewRef, target2.reviewRef);
    const secondEnvelope = await readFile(
      store.iterationArtifactPath('demo', 2, 'review-envelope.txt'),
      'utf8',
    );
    expect(secondEnvelope).toContain(`${context.baseRef}..${target2.reviewRef}`);
    expect(secondEnvelope).toContain(`${target.reviewRef}..${target2.reviewRef}`);
    expect(secondEnvelope).not.toContain('PREVIOUS_REVIEW_REF:');
    expect(secondEnvelope).toContain(
      'advance ITERATION by one but keep REVIEW_REF and TEST_STATUS equal to the review just completed',
    );
    await duet.markReviewing('demo');

    await respond('PLAN', 3, { content: 'Fix finding three' });
    await duet.ingest('demo', responseFile);
    await duet.beginExecution('demo');
    provider.getReviewTarget.mockResolvedValueOnce(target3);
    const third = await duet.prepareReview('demo', 'PASS', outputFile);
    expect(third.iterations).toHaveLength(3);
    expect(third.iterations.map((record) => record.iteration)).toEqual([1, 2, 3]);
    expect(third.iterations.map((record) => record.reviewTarget?.reviewRef)).toEqual([
      target.reviewRef,
      target2.reviewRef,
      target3.reviewRef,
    ]);
    expect(historyVerifier.isAncestor).toHaveBeenLastCalledWith(
      target2.reviewRef,
      target3.reviewRef,
    );
    expect(await duet.status('demo')).toMatchObject({
      iteration: 3,
      currentReviewRef: target3.reviewRef,
      previousReviewRef: target2.reviewRef,
      history: [
        { iteration: 1, reviewRef: target.reviewRef, testStatus: 'PASS' },
        { iteration: 2, reviewRef: target2.reviewRef, testStatus: 'PASS' },
        { iteration: 3, reviewRef: target3.reviewRef, testStatus: 'PASS' },
      ],
    });
    expect(await readFile(store.iterationArtifactPath('demo', 1, 'plan.md'), 'utf8')).toBe(
      'PLAN content',
    );
    expect(await readFile(store.iterationArtifactPath('demo', 2, 'plan.md'), 'utf8')).toBe(
      'Fix finding two',
    );
    expect(await readFile(store.iterationArtifactPath('demo', 3, 'plan.md'), 'utf8')).toBe(
      'Fix finding three',
    );
    expect(
      await readFile(store.iterationArtifactPath('demo', 1, 'review-envelope.txt'), 'utf8'),
    ).not.toBe(secondEnvelope);
  });
  it('rejects divergent review history before persisting the next target', async () => {
    await reachReviewing();
    await respond('PLAN', 2);
    await duet.ingest('demo', responseFile);
    await duet.beginExecution('demo');
    provider.getReviewTarget.mockResolvedValueOnce(target2);
    historyVerifier.isAncestor.mockResolvedValueOnce(false);
    await expect(duet.prepareReview('demo', 'PASS', outputFile)).rejects.toMatchObject({
      code: 'REVIEW_HISTORY_DIVERGED',
    });
    expect(await store.read('demo')).toMatchObject({ state: 'EXECUTING', iteration: 2 });
  });
  it('rejects a repeated REVIEW_REF as non-advancing history', async () => {
    await reachReviewing();
    await respond('PLAN', 2);
    await duet.ingest('demo', responseFile);
    await duet.beginExecution('demo');
    await expect(duet.prepareReview('demo', 'PASS', outputFile)).rejects.toMatchObject({
      code: 'REVIEW_HISTORY_DIVERGED',
    });
    expect(historyVerifier.isAncestor).not.toHaveBeenCalled();
  });
  it('persists an iteration-limit halt without accepting or writing the next PLAN', async () => {
    await duet.init('demo', requestFile, outputFile, 2);
    await respond('PLAN');
    await duet.ingest('demo', responseFile);
    await duet.beginExecution('demo');
    await duet.prepareReview('demo', 'PASS', outputFile);
    await duet.markReviewing('demo');
    await respond('PLAN', 2);
    await duet.ingest('demo', responseFile);
    await duet.beginExecution('demo');
    provider.getReviewTarget.mockResolvedValueOnce(target2);
    await duet.prepareReview('demo', 'PASS', outputFile);
    await duet.markReviewing('demo');
    await respond('PLAN', 3);
    await expect(duet.ingest('demo', responseFile)).rejects.toMatchObject({
      code: 'ITERATION_LIMIT_REACHED',
    });
    expect(await store.read('demo')).toMatchObject({
      state: 'REVIEWING',
      iteration: 2,
      halt: { code: 'ITERATION_LIMIT_REACHED', iteration: 3 },
    });
    expect(await duet.status('demo')).toMatchObject({
      state: 'REVIEWING',
      iteration: 2,
      maxIterations: 2,
      halt: { code: 'ITERATION_LIMIT_REACHED', iteration: 3 },
      previousReviewRef: target.reviewRef,
      currentReviewRef: target2.reviewRef,
    });
    await expect(
      readFile(store.iterationArtifactPath('demo', 3, 'plan.md'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(duet.beginExecution('demo')).rejects.toMatchObject({
      code: 'ITERATION_LIMIT_REACHED',
    });
  });
  it('allows PLAN 8 and halts a Reviewer PLAN 9 at the default limit', async () => {
    await init();
    for (let iteration = 1; iteration <= 8; iteration++) {
      await respond('PLAN', iteration);
      await duet.ingest('demo', responseFile);
      await duet.beginExecution('demo');
      provider.getReviewTarget.mockResolvedValueOnce({
        ...context,
        reviewRef: String(iteration).repeat(40),
        testStatus: 'PASS',
      });
      await duet.prepareReview('demo', 'PASS', outputFile);
      await duet.markReviewing('demo');
    }
    await respond('PLAN', 9);
    await expect(duet.ingest('demo', responseFile)).rejects.toMatchObject({
      code: 'ITERATION_LIMIT_REACHED',
    });
    const halted = await store.read('demo');
    expect(halted).toMatchObject({
      iteration: 8,
      state: 'REVIEWING',
      halt: { code: 'ITERATION_LIMIT_REACHED', iteration: 9 },
    });
    expect(
      halted?.version === 2 ? halted.iterations.map((record) => record.iteration) : [],
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it.each([
    ['other', 1, 'GITHUB', 'TASK_MISMATCH'],
    ['demo', 9, 'GITHUB', 'ITERATION_MISMATCH'],
    ['demo', 1, 'LOCAL', 'MODE_MISMATCH'],
  ])('rejects identity mismatch (%s)', async (taskId, iteration, mode, code) => {
    await init();
    await respond('PLAN', iteration as number, { taskId, mode });
    await expect(duet.ingest('demo', responseFile)).rejects.toMatchObject({ code });
  });
  it('rejects malformed and section-mismatched C2C', async () => {
    await init();
    await writeFile(responseFile, 'not C2C', 'utf8');
    await expect(duet.ingest('demo', responseFile)).rejects.toMatchObject({
      code: 'C2C_RESPONSE_INVALID',
    });
    await writeFile(
      responseFile,
      '[C2C/1]\nTASK: demo\nITERATION: 1\nSTATE: PLAN\nMODE: GITHUB\n\nDONE:\nwrong',
      'utf8',
    );
    await expect(duet.ingest('demo', responseFile)).rejects.toMatchObject({
      code: 'C2C_RESPONSE_INVALID',
    });
  });
  it.each([
    '{}',
    '{"state":"PLAN"}',
    '{"version":1,"taskId":7,"iteration":"1","state":"PLAN","content":false}',
    JSON.stringify({
      version: 1,
      taskId: 'demo',
      iteration: 1,
      state: 'PLAN',
      mode: 'GITHUB',
      reviewRef: 'not-a-full-sha',
      content: 'plan',
    }),
    JSON.stringify({
      version: 1,
      taskId: 'demo',
      iteration: 1,
      state: 'PLAN',
      mode: 'GITHUB',
      content: 'plan',
      unexpected: true,
    }),
  ])('rejects invalid parsed Envelope JSON', async (message) => {
    await init();
    await writeFile(responseFile, message, 'utf8');
    await expect(duet.ingest('demo', responseFile)).rejects.toMatchObject({
      code: 'C2C_RESPONSE_INVALID',
    });
  });
  it.each([
    ['other', 1, 'GITHUB', 'PLAN', 'TASK_MISMATCH'],
    ['demo', 9, 'GITHUB', 'PLAN', 'ITERATION_MISMATCH'],
    ['demo', 1, 'LOCAL', 'PLAN', 'MODE_MISMATCH'],
    ['demo', 1, 'GITHUB', 'DONE', 'RUN_STATE_INVALID'],
  ] as const)(
    'keeps lifecycle validation authoritative for parsed JSON (%s)',
    async (taskId, iteration, mode, state, code) => {
      await init();
      await respond(state, iteration, { taskId, mode }, 'json');
      await expect(duet.ingest('demo', responseFile)).rejects.toMatchObject({ code });
    },
  );
  it('rejects illegal lifecycle jumps', async () => {
    await init();
    await expect(duet.beginExecution('demo')).rejects.toMatchObject({ code: 'RUN_STATE_INVALID' });
    await expect(duet.prepareReview('demo', 'NOT_RUN', outputFile)).rejects.toMatchObject({
      code: 'RUN_STATE_INVALID',
    });
  });
  it('preserves provider safety errors', async () => {
    await init();
    await respond('PLAN');
    await duet.ingest('demo', responseFile);
    await duet.beginExecution('demo');
    provider.getReviewTarget.mockRejectedValueOnce(
      Object.assign(new Error('dirty'), { code: 'WORKTREE_DIRTY' }),
    );
    await expect(duet.prepareReview('demo', 'FAIL', outputFile)).rejects.toMatchObject({
      code: 'WORKTREE_DIRTY',
    });
    expect(await store.read('demo')).toMatchObject({ state: 'EXECUTING' });
  });
  it('keeps V1 status read-only and V1 EXECUTING recovery fail-closed after migration', async () => {
    const now = new Date().toISOString();
    const legacy: DuetRunCheckpointV1 = {
      version: 1,
      taskId: 'demo',
      mode: 'GITHUB',
      iteration: 1,
      state: 'EXECUTING',
      context,
      request: { sha256: 'e'.repeat(64) },
      plan: { sha256: 'f'.repeat(64) },
      createdAt: now,
      updatedAt: now,
    };
    await store.write(legacy);
    expect(await duet.status('demo')).toMatchObject({
      state: 'EXECUTING',
      iteration: 1,
      maxIterations: 8,
      resume:
        'Run duet reconcile-execution --task demo and follow its deterministic action; never replay execution blindly.',
    });
    expect(await store.read('demo')).toMatchObject({ version: 1 });
    await expect(duet.beginExecution('demo')).rejects.toMatchObject({
      code: 'RUN_STATE_INVALID',
    });
    expect(await store.read('demo')).toMatchObject({ version: 2, state: 'EXECUTING' });
  });
});
