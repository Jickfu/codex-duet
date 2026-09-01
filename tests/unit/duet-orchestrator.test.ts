import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TestStatus } from '../../src/core/domain.js';
import { serializeEnvelope } from '../../src/core/protocol.js';
import { DuetOrchestrator } from '../../src/duet/orchestrator.js';
import { DuetRunStore } from '../../src/duet/run-store.js';
import type { GitHubContextRef, GitHubReviewTarget } from '../../src/providers/code-provider.js';

let temporary: string;
let requestFile: string;
let outputFile: string;
let responseFile: string;
let store: DuetRunStore;
let provider: {
  prepareContext: ReturnType<typeof vi.fn<(taskId: string) => Promise<GitHubContextRef>>>;
  getReviewTarget: ReturnType<
    typeof vi.fn<(taskId: string, tests: TestStatus) => Promise<GitHubReviewTarget>>
  >;
};
let duet: DuetOrchestrator;
const context: GitHubContextRef = {
  mode: 'GITHUB',
  repository: 'owner/repo',
  remote: 'origin',
  taskId: 'demo',
  taskBranch: 'agent/task-demo',
  baseRef: 'a'.repeat(40),
};
const target: GitHubReviewTarget = { ...context, reviewRef: 'b'.repeat(40), testStatus: 'PASS' };

beforeEach(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), 'duet-orchestrator-'));
  requestFile = path.join(temporary, 'request.md');
  outputFile = path.join(temporary, 'out.txt');
  responseFile = path.join(temporary, 'response.txt');
  await writeFile(requestFile, 'Add a harmless document.', 'utf8');
  store = new DuetRunStore(path.join(temporary, '.chatbridge'));
  provider = {
    prepareContext: vi.fn(async () => context),
    getReviewTarget: vi.fn(async () => target),
  };
  duet = new DuetOrchestrator(provider as never, store);
});
afterEach(async () => rm(temporary, { recursive: true, force: true }));
async function init() {
  await duet.init('demo', requestFile, outputFile);
}
async function respond(
  state: 'PLAN' | 'BLOCKED' | 'FAILED' | 'DONE',
  iteration = 1,
  overrides: Record<string, unknown> = {},
) {
  await writeFile(
    responseFile,
    serializeEnvelope({
      version: 1,
      taskId: 'demo',
      iteration,
      state,
      mode: 'GITHUB',
      content: `${state} content`,
      ...overrides,
    }),
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
  it('initializes PLANNING once and writes a compact envelope', async () => {
    const run = await duet.init('demo', requestFile, outputFile);
    expect(run.state).toBe('PLANNING');
    expect(provider.prepareContext).toHaveBeenCalledWith('demo');
    expect(await readFile(outputFile, 'utf8')).toContain('STATE: PLANNING');
    await expect(duet.init('demo', requestFile, outputFile)).rejects.toMatchObject({
      code: 'RUN_ALREADY_EXISTS',
    });
  });
  it('moves PLAN through EXECUTING and composes the frozen provider for EXECUTED', async () => {
    await init();
    await respond('PLAN');
    expect((await duet.ingest('demo', responseFile)).state).toBe('PLAN');
    expect((await duet.beginExecution('demo')).state).toBe('EXECUTING');
    const executed = await duet.prepareReview('demo', 'PASS', outputFile);
    expect(provider.getReviewTarget).toHaveBeenCalledWith('demo', 'PASS');
    expect(executed.reviewTarget).toEqual(target);
    expect(executed.state).toBe('EXECUTED');
    expect((await duet.markReviewing('demo')).state).toBe('REVIEWING');
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
  it('persists reviewer PLAN as the next iteration', async () => {
    await reachReviewing();
    await respond('PLAN', 2);
    expect(await duet.ingest('demo', responseFile)).toMatchObject({ state: 'PLAN', iteration: 2 });
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
});
