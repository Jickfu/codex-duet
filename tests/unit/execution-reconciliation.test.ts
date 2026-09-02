import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serializeEnvelope } from '../../src/core/protocol.js';
import type { GitHubTaskCheckpoint } from '../../src/core/task.js';
import { DuetOrchestrator } from '../../src/duet/orchestrator.js';
import { DuetRunStore } from '../../src/duet/run-store.js';
import { ExecutionStore } from '../../src/duet/execution-store.js';
import type {
  ExecutionWorkspaceInspector,
  ExecutionWorkspaceState,
} from '../../src/duet/execution-workspace-inspector.js';
import type { TaskOperationLockLike } from '../../src/duet/task-operation-lock.js';
import type { GitHubContextRef, GitHubReviewTarget } from '../../src/providers/code-provider.js';
import { TaskSpecStore } from '../../src/duet/task-spec-store.js';
import { TaskContextStore } from '../../src/duet/task-context-store.js';
import {
  sha256,
  taskSpecFingerprint,
  type TaskSpecV1,
  type TaskSpecWithoutIntegrity,
} from '../../src/duet/task-spec.js';

const roots: string[] = [];
const base = 'a'.repeat(40);
const commit = 'b'.repeat(40);
const later = 'c'.repeat(40);
const context: GitHubContextRef = {
  mode: 'GITHUB',
  repository: 'owner/repo',
  remote: 'origin',
  taskId: 'demo',
  taskBranch: 'agent/task-demo',
  baseRef: base,
};

class SerialLock implements TaskOperationLockLike {
  calls: string[] = [];
  private tail = Promise.resolve();
  async withLock<T>(taskId: string, operation: () => Promise<T>): Promise<T> {
    this.calls.push(taskId);
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => (release = resolve));
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

async function fixture(compact = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'execution-reconcile-'));
  roots.push(root);
  const stateRoot = path.join(root, '.chatbridge');
  const runStore = new DuetRunStore(stateRoot);
  const executionStore = new ExecutionStore(stateRoot);
  const request = path.join(root, 'request.md');
  const response = path.join(root, 'response.txt');
  const output = path.join(root, 'output.txt');
  const taskSpecFile = path.join(root, 'task-spec.json');
  await writeFile(request, 'Add a document.', 'utf8');
  let workspace: ExecutionWorkspaceState = {
    branch: context.taskBranch,
    head: base,
    clean: true,
    conflicted: false,
  };
  const inspector: ExecutionWorkspaceInspector = {
    inspect: vi.fn(async () => ({ ...workspace })),
    isAncestor: vi.fn(async (ancestor, descendant) =>
      ancestor === base
        ? [base, commit, later].includes(descendant)
        : ancestor === commit && descendant === later,
    ),
  };
  let m2: GitHubTaskCheckpoint = {
    version: 1,
    taskId: 'demo',
    iteration: 0,
    state: 'INIT',
    mode: 'GITHUB',
    repository: context.repository,
    remote: context.remote,
    taskBranch: context.taskBranch,
    baseRef: base,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
  const target = (): GitHubReviewTarget => ({
    ...context,
    reviewRef: workspace.head,
    testStatus: 'PASS',
  });
  const provider = {
    prepareContext: vi.fn(async () => context),
    getReviewTarget: vi.fn(async () => target()),
    status: vi.fn(async () => m2),
  };
  const lock = new SerialLock();
  const taskSpecs = new TaskSpecStore(stateRoot);
  const taskContexts = new TaskContextStore(stateRoot);
  let taskSpec: TaskSpecV1 | undefined;
  if (compact) {
    const content: TaskSpecWithoutIntegrity = {
      version: 1,
      taskId: 'demo',
      mode: 'GITHUB',
      objective: 'Add a document.',
      scope: { allowed: ['docs'], forbidden: [] },
      acceptanceCriteria: [],
      exactLiterals: [],
      protocolRequirements: [],
      context: {
        repository: context.repository,
        taskBranch: context.taskBranch,
        baseRef: context.baseRef,
      },
      source: { rawRequestSha256: sha256('Add a document.') },
      contracts: {
        plannerPath: 'docs/contracts/planner-v1.md',
        reviewerPath: 'docs/contracts/reviewer-v1.md',
        resolution: 'AT_BASE_REF',
      },
    };
    taskSpec = { ...content, integrity: { sha256: taskSpecFingerprint(content) } };
    await writeFile(taskSpecFile, JSON.stringify(taskSpec), 'utf8');
  }
  const duet = new DuetOrchestrator(
    provider as never,
    runStore,
    { isAncestor: vi.fn(async () => true) },
    { store: executionStore, inspector, lock, now: () => new Date(1).toISOString() },
    taskSpecs,
    taskContexts,
  );
  await duet.init('demo', request, output, 8, compact ? taskSpecFile : undefined);
  await writeFile(
    response,
    serializeEnvelope({
      version: 1,
      taskId: 'demo',
      iteration: 1,
      state: 'PLAN',
      mode: 'GITHUB',
      repository: context.repository,
      taskBranch: context.taskBranch,
      baseRef: context.baseRef,
      content: 'Create the requested file.',
    }),
    'utf8',
  );
  await duet.ingest('demo', response);
  return {
    duet,
    runStore,
    executionStore,
    provider,
    inspector,
    lock,
    output,
    response,
    executionDependencies: {
      store: executionStore,
      inspector,
      lock,
      now: () => new Date(1).toISOString(),
    },
    taskSpecs,
    taskContexts,
    taskSpec,
    setWorkspace: (value: Partial<ExecutionWorkspaceState>) =>
      (workspace = { ...workspace, ...value }),
    setM2: (value: GitHubTaskCheckpoint) => (m2 = value),
    executedM2: (reviewRef = commit, testStatus: 'PASS' | 'FAIL' | 'NOT_RUN' = 'PASS') => ({
      ...m2,
      state: 'EXECUTED' as const,
      reviewRef,
      testStatus,
    }),
  };
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true }))));

describe('EXECUTING reconciliation', () => {
  it('writes the execution checkpoint before EXECUTING and safely reuses a torn begin', async () => {
    const x = await fixture();
    const originalWrite = x.runStore.write.bind(x.runStore);
    vi.spyOn(x.runStore, 'write').mockRejectedValueOnce(new Error('crash'));
    await expect(x.duet.beginExecution('demo')).rejects.toThrow('crash');
    expect(await x.runStore.read('demo')).toMatchObject({ state: 'PLAN' });
    const orphan = await x.executionStore.read('demo', 1);
    expect(orphan).toMatchObject({ baseline: { head: base }, planSha256: expect.any(String) });
    vi.mocked(x.runStore.write).mockImplementation(originalWrite);
    expect(await x.duet.beginExecution('demo')).toMatchObject({ state: 'EXECUTING' });
    expect((await x.executionStore.read('demo', 1))?.startedAt).toBe(orphan?.startedAt);
  });

  it.each([
    [{ branch: 'wrong' }, 'EXECUTION_BRANCH_MISMATCH'],
    [{ head: commit }, 'EXECUTION_BASE_MISMATCH'],
    [{ clean: false }, 'WORKTREE_DIRTY'],
    [{ conflicted: true, clean: false }, 'EXECUTION_CONFLICTED'],
  ] as const)('fails begin preflight for %j', async (workspace, code) => {
    const x = await fixture();
    x.setWorkspace(workspace);
    await expect(x.duet.beginExecution('demo')).rejects.toMatchObject({ code });
    expect(await x.executionStore.read('demo', 1)).toBeUndefined();
  });

  it('rejects a changed plan artifact before writing execution evidence', async () => {
    const x = await fixture();
    await writeFile(x.runStore.iterationArtifactPath('demo', 1, 'plan.md'), 'tampered', 'utf8');
    await expect(x.duet.beginExecution('demo')).rejects.toMatchObject({
      code: 'EXECUTION_PLAN_MISMATCH',
    });
    expect(await x.executionStore.read('demo', 1)).toBeUndefined();
  });

  it('keeps legacy EXECUTING without a sidecar fail-closed', async () => {
    const x = await fixture();
    const legacy = new DuetOrchestrator(x.provider as never, x.runStore, {
      isAncestor: vi.fn(async () => true),
    });
    await legacy.beginExecution('demo');
    const resumed = new DuetOrchestrator(
      x.provider as never,
      x.runStore,
      { isAncestor: vi.fn(async () => true) },
      x.executionDependencies,
    );
    await expect(resumed.reconcileExecution('demo')).rejects.toMatchObject({
      code: 'LEGACY_EXECUTION_RECOVERY_REQUIRED',
    });
    expect(await x.executionStore.read('demo', 1)).toBeUndefined();
  });

  it('classifies baseline, dirty, committed, ready, and stale evidence without workspace mutation', async () => {
    const x = await fixture();
    await x.duet.beginExecution('demo');
    expect(await x.duet.reconcileExecution('demo')).toMatchObject({
      classification: 'BASELINE_CLEAN',
      action: 'RESUME_PLAN',
      externalEffects: 'UNVERIFIED',
    });
    x.setWorkspace({ clean: false });
    expect(await x.duet.reconcileExecution('demo')).toMatchObject({
      classification: 'WORKTREE_IN_PROGRESS',
      action: 'CONTINUE_EXISTING_WORKTREE',
    });
    x.setWorkspace({ clean: true, head: commit });
    expect(await x.duet.reconcileExecution('demo')).toMatchObject({
      classification: 'TEST_EVIDENCE_REQUIRED',
      workspaceState: 'COMMITTED_CLEAN',
    });
    await x.duet.recordTests('demo', 'PASS');
    expect(await x.duet.reconcileExecution('demo')).toMatchObject({
      classification: 'READY_FOR_PREPARE_REVIEW',
      action: 'PREPARE_REVIEW',
    });
    x.setWorkspace({ head: later });
    expect(await x.duet.reconcileExecution('demo')).toMatchObject({
      classification: 'TEST_EVIDENCE_REQUIRED',
      reason: 'TEST_EVIDENCE_STALE',
    });
  });

  it('enforces exact-HEAD test evidence before normal prepare-review', async () => {
    const x = await fixture();
    await x.duet.beginExecution('demo');
    x.setWorkspace({ head: commit });
    await expect(x.duet.prepareReview('demo', 'PASS', x.output)).rejects.toMatchObject({
      code: 'TEST_EVIDENCE_REQUIRED',
    });
    await x.duet.recordTests('demo', 'FAIL');
    await expect(x.duet.prepareReview('demo', 'PASS', x.output)).rejects.toMatchObject({
      code: 'TEST_STATUS_MISMATCH',
    });
    await x.duet.recordTests('demo', 'PASS');
    expect(await x.duet.prepareReview('demo', 'PASS', x.output)).toMatchObject({
      state: 'EXECUTED',
    });
  });

  it('adopts conclusive current-iteration M2 evidence without getReviewTarget or repush', async () => {
    const x = await fixture();
    await x.duet.beginExecution('demo');
    x.setWorkspace({ head: commit });
    await x.duet.recordTests('demo', 'PASS');
    x.setM2(x.executedM2());
    expect(await x.duet.reconcileExecution('demo')).toMatchObject({
      classification: 'CURRENT_ITERATION_M2_PREPARED',
      action: 'RESUME_EXECUTED',
      adopted: true,
    });
    expect(x.provider.getReviewTarget).not.toHaveBeenCalled();
    expect(await x.runStore.read('demo')).toMatchObject({
      state: 'EXECUTED',
      iterations: [{ reviewTarget: { reviewRef: commit, testStatus: 'PASS' } }],
    });
    expect(
      await readFile(x.runStore.iterationArtifactPath('demo', 1, 'review-envelope.txt'), 'utf8'),
    ).toContain(`REVIEW_REF: ${commit}`);
  });

  it('fails Compact Crash-B adoption on missing TaskSpec, then adopts after exact restoration without repush', async () => {
    const x = await fixture(true);
    await x.duet.beginExecution('demo');
    x.setWorkspace({ head: commit });
    await x.duet.recordTests('demo', 'PASS');
    x.setM2(x.executedM2());
    await rm(x.taskSpecs.pathFor('demo'));
    await expect(x.duet.reconcileExecution('demo')).rejects.toMatchObject({
      code: 'TASK_SPEC_MISSING',
    });
    expect(x.provider.getReviewTarget).not.toHaveBeenCalled();
    expect(await x.runStore.read('demo')).toMatchObject({ state: 'EXECUTING' });
    await x.taskSpecs.createOrVerify(x.taskSpec!);
    expect(await x.duet.reconcileExecution('demo')).toMatchObject({
      classification: 'CURRENT_ITERATION_M2_PREPARED',
      action: 'RESUME_EXECUTED',
      adopted: true,
    });
    expect(x.provider.getReviewTarget).not.toHaveBeenCalled();
    expect(await x.runStore.read('demo')).toMatchObject({ state: 'EXECUTED' });
  });

  it.each([
    [{ clean: false }, commit, 'PASS'],
    [{ head: later }, commit, 'PASS'],
    [{}, commit, 'FAIL'],
  ] as const)(
    'fails closed when current M2 evidence diverges (%j)',
    async (workspace, ref, status) => {
      const x = await fixture();
      await x.duet.beginExecution('demo');
      x.setWorkspace({ head: commit });
      await x.duet.recordTests('demo', 'PASS');
      x.setWorkspace(workspace);
      x.setM2(x.executedM2(ref, status));
      await expect(x.duet.reconcileExecution('demo')).rejects.toMatchObject({
        code: 'M2_REVIEW_EVIDENCE_DIVERGED',
      });
    },
  );

  it('serializes record, reconcile, and prepare through the same task lock', async () => {
    const x = await fixture();
    await x.duet.beginExecution('demo');
    x.setWorkspace({ head: commit });
    await x.duet.recordTests('demo', 'PASS');
    await Promise.all([
      x.duet.reconcileExecution('demo'),
      x.duet.prepareReview('demo', 'PASS', x.output),
    ]);
    expect(x.lock.calls.every((task) => task === 'demo')).toBe(true);
    expect(x.lock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('serializes record-tests against prepare-review without partial evidence', async () => {
    const x = await fixture();
    await x.duet.beginExecution('demo');
    x.setWorkspace({ head: commit });
    const [recorded, prepared] = await Promise.all([
      x.duet.recordTests('demo', 'PASS'),
      x.duet.prepareReview('demo', 'PASS', x.output),
    ]);
    expect(recorded.tests).toMatchObject({ status: 'PASS', head: commit });
    expect(prepared.state).toBe('EXECUTED');
    expect(x.provider.getReviewTarget).toHaveBeenCalledOnce();
  });

  it('does not mistake prior-iteration M2 evidence for current preparation', async () => {
    const x = await fixture();
    await x.duet.beginExecution('demo');
    x.setWorkspace({ head: commit });
    await x.duet.recordTests('demo', 'PASS');
    await x.duet.prepareReview('demo', 'PASS', x.output);
    x.setM2(x.executedM2(commit));
    await x.duet.markReviewing('demo');
    await writeFile(
      x.response,
      serializeEnvelope({
        version: 1,
        taskId: 'demo',
        iteration: 2,
        state: 'PLAN',
        mode: 'GITHUB',
        repository: context.repository,
        taskBranch: context.taskBranch,
        baseRef: context.baseRef,
        reviewRef: commit,
        testStatus: 'PASS',
        content: 'Apply the review correction.',
      }),
      'utf8',
    );
    await x.duet.ingest('demo', x.response);
    await x.duet.beginExecution('demo');
    expect(await x.duet.reconcileExecution('demo')).toMatchObject({
      iteration: 2,
      executionBaseRef: commit,
      classification: 'BASELINE_CLEAN',
    });
    x.setWorkspace({ head: later });
    await x.duet.recordTests('demo', 'PASS');
    x.setM2(x.executedM2(later));
    expect(await x.duet.reconcileExecution('demo')).toMatchObject({
      classification: 'CURRENT_ITERATION_M2_PREPARED',
      adopted: true,
    });
  });
});
