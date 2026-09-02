import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { TestStatus } from '../core/domain.js';
import type { TaskCheckpoint } from '../core/task.js';
import { TaskIdSchema } from '../core/domain.js';
import { ChatbridgeError } from '../core/errors.js';
import {
  EnvelopeSchema,
  parseEnvelope,
  serializeEnvelope,
  type Envelope,
  type TaskState,
} from '../core/protocol.js';
import { assertTransition } from '../core/state-machine.js';
import { githubReviewEnvelope } from '../github/review-envelope.js';
import type { GitHubCodeProvider } from '../github/github-code-provider.js';
import type { GitHubContextRef, GitHubReviewTarget } from '../providers/code-provider.js';
import { MaxIterationsSchema, type DuetRunCheckpoint, type DuetRunCheckpointV2 } from './run.js';
import { DuetRunStore } from './run-store.js';
import type { ReviewHistoryVerifier } from './review-history-verifier.js';
import { iterativeReviewEnvelope } from './review-envelope.js';
import { assertGitHubResponseIdentity } from './response-identity.js';
import { ExecutionStore } from './execution-store.js';
import { TaskSpecStore } from './task-spec-store.js';
import { validateTaskSpecCandidate, type TaskSpecV1 } from './task-spec.js';
import { TaskContextStore, type TaskContextV1 } from './task-context-store.js';
import {
  assertCompactC2CPayload,
  plannerControlEnvelope,
  reviewerControlEnvelope,
} from './control-projection.js';
import type {
  ExecutionWorkspaceInspector,
  ExecutionWorkspaceState,
} from './execution-workspace-inspector.js';
import type { TaskOperationLockLike } from './task-operation-lock.js';
import type { ExecutionCheckpointV1 } from './execution-checkpoint.js';

export type DuetStatus = {
  taskId: string;
  state: TaskState;
  iteration: number;
  maxIterations: number;
  halt?: { code: 'ITERATION_LIMIT_REACHED'; iteration: number };
  repository: string;
  taskBranch: string;
  baseRef: string;
  currentPlanArtifact?: string;
  currentReviewEnvelope?: string;
  currentReviewRef?: string;
  previousReviewRef?: string;
  history: Array<{ iteration: number; reviewRef?: string; testStatus?: TestStatus }>;
  resume: string;
};

export type ExecutionReconciliation = {
  taskId: string;
  iteration: number;
  classification:
    | 'BASELINE_CLEAN'
    | 'WORKTREE_IN_PROGRESS'
    | 'TEST_EVIDENCE_REQUIRED'
    | 'READY_FOR_PREPARE_REVIEW'
    | 'CURRENT_ITERATION_M2_PREPARED';
  workspaceState: 'BASELINE_CLEAN' | 'WORKTREE_IN_PROGRESS' | 'COMMITTED_CLEAN';
  action:
    | 'RESUME_PLAN'
    | 'CONTINUE_EXISTING_WORKTREE'
    | 'RECORD_HONEST_TEST_EVIDENCE'
    | 'RUN_TESTS_AND_RECORD_CURRENT_HEAD'
    | 'PREPARE_REVIEW'
    | 'RESUME_EXECUTED';
  reason?: 'TEST_EVIDENCE_STALE';
  executionBaseRef: string;
  head: string;
  clean: boolean;
  conflicted: boolean;
  externalEffects: 'UNVERIFIED';
  adopted?: true;
};

export type ExecutionDependencies = {
  store: ExecutionStore;
  inspector: ExecutionWorkspaceInspector;
  lock: TaskOperationLockLike;
  now?: () => string;
};

export class DuetOrchestrator {
  constructor(
    private readonly provider: Pick<
      GitHubCodeProvider,
      'prepareContext' | 'getReviewTarget' | 'status'
    >,
    private readonly store: DuetRunStore,
    private readonly historyVerifier: ReviewHistoryVerifier,
    private readonly execution?: ExecutionDependencies,
    private readonly taskSpecs?: TaskSpecStore,
    private readonly taskContexts?: TaskContextStore,
  ) {}

  async init(
    taskIdInput: string,
    requestFile: string,
    outputFile: string,
    maxIterationsInput = 8,
    taskSpecFile?: string,
  ): Promise<DuetRunCheckpointV2> {
    const taskId = this.taskId(taskIdInput);
    if (await this.store.read(taskId))
      throw new ChatbridgeError(`Run already exists for ${taskId}`, 'RUN_ALREADY_EXISTS');
    const request = await readFile(requestFile, 'utf8');
    if (!request.trim()) throw new ChatbridgeError('Request file is empty', 'REQUEST_EMPTY');
    const [persistedTaskSpec, persistedTaskContext, persistedPlannerControl] = await Promise.all([
      this.taskSpecs?.read(taskId),
      this.taskContexts?.read(taskId),
      this.readPlannerControl(taskId),
    ]);
    if (!persistedTaskSpec && (persistedTaskContext || persistedPlannerControl !== undefined))
      throw new ChatbridgeError(
        'Partial Compact initialization evidence is missing its authoritative TaskSpec',
        'TASK_SPEC_MISSING',
      );
    let suppliedTaskSpec: TaskSpecV1 | undefined;
    if (taskSpecFile) {
      if (!this.taskSpecs || !this.taskContexts)
        throw new ChatbridgeError('TaskSpec storage is unavailable', 'TASK_SPEC_STORE_UNAVAILABLE');
      suppliedTaskSpec = validateTaskSpecCandidate(
        JSON.parse(await readFile(taskSpecFile, 'utf8')) as unknown,
        { taskId, mode: 'GITHUB', rawRequest: request },
      );
      if (persistedTaskSpec) await this.taskSpecs.createOrVerify(suppliedTaskSpec);
    }
    const recoveredTaskSpec = suppliedTaskSpec ?? persistedTaskSpec;
    if (recoveredTaskSpec) {
      if (!this.taskSpecs || !this.taskContexts)
        throw new ChatbridgeError('TaskSpec storage is unavailable', 'TASK_SPEC_STORE_UNAVAILABLE');
      validateTaskSpecCandidate(recoveredTaskSpec, {
        taskId,
        mode: 'GITHUB',
        rawRequest: request,
      });
    }
    const limits = MaxIterationsSchema.safeParse(maxIterationsInput);
    if (!limits.success)
      throw new ChatbridgeError(
        'maxIterations must be a positive integer no greater than 100',
        'INVALID_MAX_ITERATIONS',
      );
    const rawContext = await this.provider.prepareContext(taskId);
    if (rawContext.mode !== 'GITHUB')
      throw new ChatbridgeError('M3.0 supports GITHUB mode only', 'MODE_MISMATCH');
    const context = rawContext as GitHubContextRef;
    const taskSpec = recoveredTaskSpec
      ? validateTaskSpecCandidate(recoveredTaskSpec, {
          taskId,
          mode: 'GITHUB',
          rawRequest: request,
          context,
        })
      : undefined;
    assertTransition('INIT', 'PLANNING');
    const now = new Date().toISOString();
    const run: DuetRunCheckpointV2 = {
      version: 2,
      taskId,
      mode: 'GITHUB',
      iteration: 1,
      state: 'PLANNING',
      context,
      request: { sha256: sha256(request) },
      iterations: [],
      limits: { maxIterations: limits.data },
      createdAt: now,
      updatedAt: now,
    };
    const plannerEnvelope = taskSpec
      ? plannerControlEnvelope(context, taskSpec, run.iteration)
      : planningEnvelope(run, request);
    const taskContext: TaskContextV1 | undefined = taskSpec
      ? {
          version: 1,
          taskId,
          taskSpecSha256: taskSpec.integrity.sha256,
          plannerControlSha256: sha256(plannerEnvelope),
        }
      : undefined;
    if (taskContext) {
      if (persistedTaskContext && !sameTaskContext(persistedTaskContext, taskContext))
        throw new ChatbridgeError(
          'TaskContext already exists with different compact-task evidence',
          'TASK_CONTEXT_IMMUTABLE',
        );
    }
    await this.store.writeRequestArtifact(taskId, request);
    if (taskSpec) await this.taskSpecs!.createOrVerify(taskSpec);
    if (taskSpec) await this.persistControl(run.taskId, run.iteration, 'planner', plannerEnvelope);
    if (taskContext) await this.taskContexts!.createOrVerify(taskContext);
    await this.store.write(run);
    await writeFile(outputFile, plannerEnvelope, 'utf8');
    return run;
  }

  async ingest(taskIdInput: string, messageFile: string): Promise<DuetRunCheckpointV2> {
    const run = await this.requireMutableRun(taskIdInput);
    this.requireNoHalt(run);
    let envelope: Envelope;
    try {
      envelope = parseIngestEnvelope(await readFile(messageFile, 'utf8'));
    } catch (error) {
      throw new ChatbridgeError(
        error instanceof Error ? error.message : 'Invalid C2C response',
        'C2C_RESPONSE_INVALID',
      );
    }
    if (envelope.taskId !== run.taskId)
      throw new ChatbridgeError('C2C task does not match run', 'TASK_MISMATCH');
    assertGitHubResponseIdentity(run, envelope);
    const expectedIteration =
      run.state === 'REVIEWING' && envelope.state === 'PLAN' ? run.iteration + 1 : run.iteration;
    if (envelope.iteration !== expectedIteration)
      throw new ChatbridgeError('C2C iteration does not match run', 'ITERATION_MISMATCH');
    if (!allowedResponse(run.state, envelope.state))
      throw new ChatbridgeError(
        `Response state ${envelope.state} is invalid while run is ${run.state}`,
        'RUN_STATE_INVALID',
      );
    try {
      assertTransition(run.state, envelope.state);
    } catch (error) {
      throw new ChatbridgeError(
        error instanceof Error ? error.message : 'Illegal run transition',
        'RUN_STATE_INVALID',
      );
    }
    if (
      run.state === 'REVIEWING' &&
      envelope.state === 'PLAN' &&
      envelope.iteration > run.limits.maxIterations
    ) {
      await this.store.write({
        ...run,
        halt: { code: 'ITERATION_LIMIT_REACHED', iteration: envelope.iteration },
        updatedAt: new Date().toISOString(),
      });
      throw new ChatbridgeError(
        `Iteration ${envelope.iteration} exceeds maxIterations ${run.limits.maxIterations}`,
        'ITERATION_LIMIT_REACHED',
      );
    }
    const updated: DuetRunCheckpointV2 = {
      ...run,
      iteration: envelope.state === 'PLAN' ? envelope.iteration : run.iteration,
      state: envelope.state,
      updatedAt: new Date().toISOString(),
      ...(envelope.state === 'BLOCKED'
        ? { blockedPhase: run.state as 'PLANNING' | 'REVIEWING' }
        : {}),
    };
    if (envelope.state === 'PLAN') {
      await this.store.writeIterationArtifact(
        run.taskId,
        envelope.iteration,
        'plan.md',
        envelope.content,
      );
      updated.iterations = [
        ...run.iterations,
        { iteration: envelope.iteration, plan: { sha256: sha256(envelope.content) } },
      ];
      delete updated.blockedPhase;
      delete updated.halt;
    }
    await this.store.write(updated);
    return updated;
  }

  async beginExecution(taskIdInput: string): Promise<DuetRunCheckpointV2> {
    if (this.execution)
      return this.execution.lock.withLock(this.taskId(taskIdInput), () =>
        this.beginExecutionWithEvidence(taskIdInput),
      );
    const run = await this.requireMutableRun(taskIdInput);
    this.requireNoHalt(run);
    this.transition(run.state, 'EXECUTING');
    const updated = { ...run, state: 'EXECUTING' as const, updatedAt: new Date().toISOString() };
    await this.store.write(updated);
    return updated;
  }

  private async beginExecutionWithEvidence(taskIdInput: string): Promise<DuetRunCheckpointV2> {
    const run = await this.requireMutableRun(taskIdInput);
    this.requireNoHalt(run);
    this.transition(run.state, 'EXECUTING');
    const [planSha256, workspace] = await Promise.all([
      this.validatedPlanSha(run),
      this.execution!.inspector.inspect(),
    ]);
    const base = executionBase(run);
    this.requireWorkspaceIdentity(run, workspace);
    if (workspace.conflicted)
      throw new ChatbridgeError('Worktree contains conflicts', 'EXECUTION_CONFLICTED');
    if (!workspace.clean) throw new ChatbridgeError('Worktree must be clean', 'WORKTREE_DIRTY');
    if (workspace.head !== base)
      throw new ChatbridgeError('HEAD does not match execution base', 'EXECUTION_BASE_MISMATCH');
    const existing = await this.execution!.store.read(run.taskId, run.iteration);
    const expected = {
      taskId: run.taskId,
      iteration: run.iteration,
      planSha256,
      taskBranch: run.context.taskBranch,
      head: base,
    };
    if (existing) this.requireCheckpointIdentity(existing, expected);
    else
      await this.execution!.store.write({
        version: 1,
        taskId: run.taskId,
        iteration: run.iteration,
        planSha256,
        baseline: { taskBranch: run.context.taskBranch, head: base },
        startedAt: this.now(),
      });
    const updated = { ...run, state: 'EXECUTING' as const, updatedAt: this.now() };
    await this.store.write(updated);
    return updated;
  }

  async recordTests(taskIdInput: string, status: TestStatus): Promise<ExecutionCheckpointV1> {
    if (!this.execution)
      throw new ChatbridgeError(
        'Execution evidence is unavailable',
        'EXECUTION_CHECKPOINT_MISSING',
      );
    return this.execution.lock.withLock(this.taskId(taskIdInput), async () => {
      const run = await this.requireMutableRun(taskIdInput);
      if (run.state !== 'EXECUTING')
        throw new ChatbridgeError('Run is not EXECUTING', 'RUN_STATE_INVALID');
      const checkpoint = await this.requireExecutionCheckpoint(run);
      const workspace = await this.execution!.inspector.inspect();
      this.requireWorkspaceForExecution(run, checkpoint, workspace);
      if (!workspace.clean) throw new ChatbridgeError('Worktree must be clean', 'WORKTREE_DIRTY');
      if (!(await this.execution!.inspector.isAncestor(executionBase(run), workspace.head)))
        throw new ChatbridgeError(
          'HEAD diverged from execution base',
          'EXECUTION_HISTORY_DIVERGED',
        );
      const m2 = await this.provider.status(run.taskId);
      if (isCurrentM2Evidence(m2, executionBase(run)))
        throw new ChatbridgeError(
          'Frozen M2 review evidence already exists',
          'M2_REVIEW_ALREADY_PREPARED',
        );
      const updated: ExecutionCheckpointV1 = {
        ...checkpoint,
        tests: { status, head: workspace.head, recordedAt: this.now() },
      };
      await this.execution!.store.write(updated);
      return updated;
    });
  }

  async prepareReview(
    taskIdInput: string,
    tests: TestStatus,
    outputFile: string,
  ): Promise<DuetRunCheckpointV2> {
    if (this.execution)
      return this.execution.lock.withLock(this.taskId(taskIdInput), () =>
        this.prepareReviewUnlocked(taskIdInput, tests, outputFile),
      );
    return this.prepareReviewUnlocked(taskIdInput, tests, outputFile);
  }

  private async prepareReviewUnlocked(
    taskIdInput: string,
    tests: TestStatus,
    outputFile: string,
  ): Promise<DuetRunCheckpointV2> {
    const run = await this.requireMutableRun(taskIdInput);
    this.requireNoHalt(run);
    this.transition(run.state, 'EXECUTED');
    if (this.execution) await this.requirePrepareReviewEvidence(run, tests);
    const taskSpec = await this.resolveCompactTaskSpec(run);
    const rawTarget = await this.provider.getReviewTarget(run.taskId, tests);
    if (rawTarget.mode !== 'GITHUB')
      throw new ChatbridgeError('M3.0 supports GITHUB mode only', 'MODE_MISMATCH');
    const reviewTarget = rawTarget as GitHubReviewTarget;
    const { updated, envelope } = await this.persistExecutedReview(run, reviewTarget, taskSpec);
    await writeFile(outputFile, envelope, 'utf8');
    return updated;
  }

  async reconcileExecution(taskIdInput: string): Promise<ExecutionReconciliation> {
    if (!this.execution)
      throw new ChatbridgeError(
        'Execution evidence is unavailable',
        'EXECUTION_CHECKPOINT_MISSING',
      );
    return this.execution.lock.withLock(this.taskId(taskIdInput), async () => {
      const run = await this.requireMutableRun(taskIdInput);
      if (run.state !== 'EXECUTING')
        throw new ChatbridgeError('Run is not EXECUTING', 'RUN_STATE_INVALID');
      const checkpoint = await this.requireExecutionCheckpoint(run);
      const workspace = await this.execution!.inspector.inspect();
      this.requireWorkspaceForExecution(run, checkpoint, workspace);
      const base = executionBase(run);
      const m2 = await this.provider.status(run.taskId);
      if (isCurrentM2Evidence(m2, base)) return this.adoptCurrentM2(run, checkpoint, workspace, m2);
      return this.classifyExecution(run, checkpoint, workspace);
    });
  }

  async markReviewing(taskIdInput: string): Promise<DuetRunCheckpointV2> {
    const run = await this.requireMutableRun(taskIdInput);
    this.requireNoHalt(run);
    this.transition(run.state, 'REVIEWING');
    const updated = { ...run, state: 'REVIEWING' as const, updatedAt: new Date().toISOString() };
    await this.store.write(updated);
    return updated;
  }

  async status(taskIdInput: string): Promise<DuetStatus> {
    const run = await this.requireRun(taskIdInput);
    const history = historySummary(run);
    const currentReview = history.find((item) => item.iteration === run.iteration);
    const previousReview = [...history]
      .reverse()
      .find((item) => item.iteration < run.iteration && item.reviewRef);
    return {
      taskId: run.taskId,
      state: run.state,
      iteration: run.iteration,
      maxIterations: run.version === 2 ? run.limits.maxIterations : 8,
      ...(run.version === 2 && run.halt ? { halt: run.halt } : {}),
      repository: run.context.repository,
      taskBranch: run.context.taskBranch,
      baseRef: run.context.baseRef,
      ...(hasPlan(run)
        ? {
            currentPlanArtifact:
              run.version === 2
                ? this.store.iterationArtifactPath(run.taskId, run.iteration, 'plan.md')
                : this.store.legacyArtifactPath(run.taskId, 'plan.md'),
          }
        : {}),
      ...(currentReview?.reviewRef
        ? {
            currentReviewEnvelope:
              run.version === 2
                ? this.store.iterationArtifactPath(run.taskId, run.iteration, 'review-envelope.txt')
                : this.store.legacyArtifactPath(run.taskId, 'review-envelope.txt'),
          }
        : {}),
      ...(currentReview?.reviewRef ? { currentReviewRef: currentReview.reviewRef } : {}),
      ...(previousReview?.reviewRef ? { previousReviewRef: previousReview.reviewRef } : {}),
      history,
      resume:
        run.version === 2 && run.halt
          ? 'ITERATION_LIMIT_REACHED: stop and report the configured iteration limit.'
          : run.state === 'EXECUTING'
            ? `Run duet reconcile-execution --task ${run.taskId} and follow its deterministic action; never replay execution blindly.`
            : resumeInstruction(run.state),
    };
  }

  private async validatedPlanSha(run: DuetRunCheckpointV2): Promise<string> {
    let content: string;
    try {
      content = await readFile(
        this.store.iterationArtifactPath(run.taskId, run.iteration, 'plan.md'),
        'utf8',
      );
    } catch {
      throw new ChatbridgeError('Current plan artifact is unavailable', 'EXECUTION_PLAN_MISMATCH');
    }
    const computed = sha256(content);
    const evidence = run.iterations[run.iteration - 1]?.plan;
    if (!evidence)
      throw new ChatbridgeError('Current plan evidence is unavailable', 'EXECUTION_PLAN_MISMATCH');
    if ('sha256' in evidence && evidence.sha256 !== computed)
      throw new ChatbridgeError('Current plan hash does not match', 'EXECUTION_PLAN_MISMATCH');
    return computed;
  }

  private requireWorkspaceIdentity(
    run: DuetRunCheckpointV2,
    workspace: ExecutionWorkspaceState,
  ): void {
    if (workspace.branch !== run.context.taskBranch)
      throw new ChatbridgeError(
        'Current branch is not the task branch',
        'EXECUTION_BRANCH_MISMATCH',
      );
  }

  private requireCheckpointIdentity(
    checkpoint: ExecutionCheckpointV1,
    expected: {
      taskId: string;
      iteration: number;
      planSha256: string;
      taskBranch: string;
      head: string;
    },
  ): void {
    if (
      checkpoint.taskId !== expected.taskId ||
      checkpoint.iteration !== expected.iteration ||
      checkpoint.planSha256 !== expected.planSha256 ||
      checkpoint.baseline.taskBranch !== expected.taskBranch ||
      checkpoint.baseline.head !== expected.head
    )
      throw new ChatbridgeError(
        'Execution checkpoint identity does not match the run',
        'EXECUTION_CHECKPOINT_INVALID',
      );
  }

  private async requireExecutionCheckpoint(
    run: DuetRunCheckpointV2,
  ): Promise<ExecutionCheckpointV1> {
    const checkpoint = await this.execution!.store.read(run.taskId, run.iteration);
    if (!checkpoint)
      throw new ChatbridgeError(
        'Legacy EXECUTING run has no execution checkpoint',
        'LEGACY_EXECUTION_RECOVERY_REQUIRED',
      );
    this.requireCheckpointIdentity(checkpoint, {
      taskId: run.taskId,
      iteration: run.iteration,
      planSha256: await this.validatedPlanSha(run),
      taskBranch: run.context.taskBranch,
      head: executionBase(run),
    });
    return checkpoint;
  }

  private requireWorkspaceForExecution(
    run: DuetRunCheckpointV2,
    checkpoint: ExecutionCheckpointV1,
    workspace: ExecutionWorkspaceState,
  ): void {
    this.requireWorkspaceIdentity(run, workspace);
    if (workspace.conflicted)
      throw new ChatbridgeError('Worktree contains conflicts', 'EXECUTION_CONFLICTED');
    if (checkpoint.baseline.head !== executionBase(run))
      throw new ChatbridgeError(
        'Execution base does not match durable history',
        'EXECUTION_BASE_MISMATCH',
      );
  }

  private async requirePrepareReviewEvidence(
    run: DuetRunCheckpointV2,
    tests: TestStatus,
  ): Promise<void> {
    const checkpoint = await this.requireExecutionCheckpoint(run);
    const workspace = await this.execution!.inspector.inspect();
    this.requireWorkspaceForExecution(run, checkpoint, workspace);
    if (!workspace.clean) throw new ChatbridgeError('Worktree must be clean', 'WORKTREE_DIRTY');
    const base = executionBase(run);
    if (
      workspace.head === base ||
      !(await this.execution!.inspector.isAncestor(base, workspace.head))
    )
      throw new ChatbridgeError(
        'HEAD is not a strict descendant of execution base',
        'EXECUTION_HISTORY_DIVERGED',
      );
    if (!checkpoint.tests)
      throw new ChatbridgeError('Exact-HEAD test evidence is required', 'TEST_EVIDENCE_REQUIRED');
    if (checkpoint.tests.head !== workspace.head)
      throw new ChatbridgeError('Test evidence belongs to another HEAD', 'TEST_EVIDENCE_STALE');
    if (checkpoint.tests.status !== tests)
      throw new ChatbridgeError(
        'CLI test status does not match durable evidence',
        'TEST_STATUS_MISMATCH',
      );
    if (isCurrentM2Evidence(await this.provider.status(run.taskId), base))
      throw new ChatbridgeError(
        'Frozen M2 review evidence already exists; reconcile execution instead',
        'M2_REVIEW_ALREADY_PREPARED',
      );
  }

  private async classifyExecution(
    run: DuetRunCheckpointV2,
    checkpoint: ExecutionCheckpointV1,
    workspace: ExecutionWorkspaceState,
  ): Promise<ExecutionReconciliation> {
    const base = executionBase(run);
    if (
      workspace.head !== base &&
      !(await this.execution!.inspector.isAncestor(base, workspace.head))
    )
      throw new ChatbridgeError('HEAD diverged from execution base', 'EXECUTION_HISTORY_DIVERGED');
    const common = reconciliationIdentity(run, workspace, base);
    if (!workspace.clean)
      return {
        ...common,
        classification: 'WORKTREE_IN_PROGRESS',
        workspaceState: 'WORKTREE_IN_PROGRESS',
        action: 'CONTINUE_EXISTING_WORKTREE',
      };
    if (workspace.head === base)
      return {
        ...common,
        classification: 'BASELINE_CLEAN',
        workspaceState: 'BASELINE_CLEAN',
        action: 'RESUME_PLAN',
      };
    if (!checkpoint.tests)
      return {
        ...common,
        classification: 'TEST_EVIDENCE_REQUIRED',
        workspaceState: 'COMMITTED_CLEAN',
        action: 'RECORD_HONEST_TEST_EVIDENCE',
      };
    if (checkpoint.tests.head !== workspace.head)
      return {
        ...common,
        classification: 'TEST_EVIDENCE_REQUIRED',
        workspaceState: 'COMMITTED_CLEAN',
        action: 'RUN_TESTS_AND_RECORD_CURRENT_HEAD',
        reason: 'TEST_EVIDENCE_STALE',
      };
    return {
      ...common,
      classification: 'READY_FOR_PREPARE_REVIEW',
      workspaceState: 'COMMITTED_CLEAN',
      action: 'PREPARE_REVIEW',
    };
  }

  private async adoptCurrentM2(
    run: DuetRunCheckpointV2,
    checkpoint: ExecutionCheckpointV1,
    workspace: ExecutionWorkspaceState,
    evidence: TaskCheckpoint,
  ): Promise<ExecutionReconciliation> {
    const base = executionBase(run);
    const diverged = () =>
      new ChatbridgeError(
        'Frozen M2 review evidence conflicts with execution state',
        'M2_REVIEW_EVIDENCE_DIVERGED',
      );
    if (
      evidence.mode !== 'GITHUB' ||
      evidence.state !== 'EXECUTED' ||
      !evidence.reviewRef ||
      !evidence.testStatus ||
      evidence.repository !== run.context.repository ||
      evidence.remote !== run.context.remote ||
      evidence.taskBranch !== run.context.taskBranch ||
      evidence.baseRef !== run.context.baseRef ||
      evidence.reviewRef === base ||
      workspace.head !== evidence.reviewRef ||
      !workspace.clean ||
      !checkpoint.tests ||
      checkpoint.tests.head !== evidence.reviewRef ||
      checkpoint.tests.status !== evidence.testStatus ||
      !(await this.execution!.inspector.isAncestor(base, evidence.reviewRef))
    )
      throw diverged();
    const previousReviewRef = previousReviewTarget(run)?.reviewRef;
    if (
      previousReviewRef &&
      (previousReviewRef === evidence.reviewRef ||
        !(await this.historyVerifier.isAncestor(previousReviewRef, evidence.reviewRef)))
    )
      throw diverged();
    const reviewTarget: GitHubReviewTarget = {
      ...run.context,
      reviewRef: evidence.reviewRef,
      testStatus: evidence.testStatus,
    };
    const taskSpec = await this.resolveCompactTaskSpec(run);
    await this.persistExecutedReview(run, reviewTarget, taskSpec);
    return {
      ...reconciliationIdentity(run, workspace, base),
      classification: 'CURRENT_ITERATION_M2_PREPARED',
      workspaceState: 'COMMITTED_CLEAN',
      action: 'RESUME_EXECUTED',
      adopted: true,
    };
  }

  private async persistExecutedReview(
    run: DuetRunCheckpointV2,
    reviewTarget: GitHubReviewTarget,
    taskSpec: TaskSpecV1 | undefined,
  ): Promise<{ updated: DuetRunCheckpointV2; envelope: string }> {
    const previousReviewRef = previousReviewTarget(run)?.reviewRef;
    if (
      previousReviewRef &&
      (previousReviewRef === reviewTarget.reviewRef ||
        !(await this.historyVerifier.isAncestor(previousReviewRef, reviewTarget.reviewRef)))
    )
      throw new ChatbridgeError(
        'Previous REVIEW_REF is not an ancestor of current REVIEW_REF',
        'REVIEW_HISTORY_DIVERGED',
      );
    const envelope = taskSpec
      ? reviewerControlEnvelope(
          reviewTarget,
          taskSpec.contracts.reviewerPath,
          run.iteration,
          previousReviewRef,
        )
      : previousReviewRef
        ? iterativeReviewEnvelope(reviewTarget, run.iteration, previousReviewRef)
        : githubReviewEnvelope(reviewTarget, run.iteration);
    const current = run.iterations[run.iteration - 1]!;
    const updated: DuetRunCheckpointV2 = {
      ...run,
      state: 'EXECUTED',
      iterations: [...run.iterations.slice(0, -1), { ...current, reviewTarget }],
      updatedAt: this.now(),
    };
    await this.store.writeIterationArtifact(
      run.taskId,
      run.iteration,
      'review-envelope.txt',
      envelope,
    );
    if (taskSpec) await this.persistControl(run.taskId, run.iteration, 'reviewer', envelope);
    await this.store.write(updated);
    return { updated, envelope };
  }

  private async resolveCompactTaskSpec(run: DuetRunCheckpointV2): Promise<TaskSpecV1 | undefined> {
    const [taskContext, taskSpec] = await Promise.all([
      this.taskContexts?.read(run.taskId),
      this.taskSpecs?.read(run.taskId),
    ]);
    if (!taskContext) {
      if (taskSpec)
        throw new ChatbridgeError(
          'TaskSpec exists without the Compact-C2C task marker',
          'TASK_CONTEXT_MISSING',
        );
      return undefined;
    }
    if (!taskSpec)
      throw new ChatbridgeError(
        'Compact-C2C task is missing its authoritative TaskSpec',
        'TASK_SPEC_MISSING',
      );
    if (taskSpec.integrity.sha256 !== taskContext.taskSpecSha256)
      throw new ChatbridgeError(
        'TaskSpec fingerprint does not match TaskContext',
        'TASK_SPEC_FINGERPRINT_MISMATCH',
      );
    let plannerControl: string;
    try {
      plannerControl = await readFile(
        this.store.iterationArtifactPath(run.taskId, 1, 'planner-control.txt'),
        'utf8',
      );
    } catch {
      throw new ChatbridgeError(
        'Compact-C2C task is missing its Planner control artifact',
        'PLANNER_CONTROL_MISSING',
      );
    }
    if (sha256(plannerControl) !== taskContext.plannerControlSha256)
      throw new ChatbridgeError(
        'Planner control fingerprint does not match TaskContext',
        'PLANNER_CONTROL_FINGERPRINT_MISMATCH',
      );
    return taskSpec;
  }

  private async persistControl(
    taskId: string,
    iteration: number,
    role: 'planner' | 'reviewer',
    envelope: string,
  ): Promise<void> {
    const bytes = assertCompactC2CPayload(envelope);
    const metadata = `${JSON.stringify({ version: 1, sha256: sha256(envelope), bytes }, null, 2)}\n`;
    if (role === 'planner') {
      await this.store.createOrVerifyIterationArtifact(
        taskId,
        iteration,
        'planner-control.txt',
        envelope,
      );
      await this.store.createOrVerifyIterationArtifact(
        taskId,
        iteration,
        'planner-control.json',
        metadata,
      );
      return;
    }
    await this.store.writeIterationArtifact(taskId, iteration, 'reviewer-control.txt', envelope);
    await this.store.writeIterationArtifact(taskId, iteration, 'reviewer-control.json', metadata);
  }

  private async readPlannerControl(taskId: string): Promise<string | undefined> {
    try {
      return await readFile(
        this.store.iterationArtifactPath(taskId, 1, 'planner-control.txt'),
        'utf8',
      );
    } catch (error: any) {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private now(): string {
    return this.execution?.now?.() ?? new Date().toISOString();
  }

  private async requireRun(taskIdInput: string): Promise<DuetRunCheckpoint> {
    const taskId = this.taskId(taskIdInput);
    const run = await this.store.read(taskId);
    if (!run) throw new ChatbridgeError(`Run not found for ${taskId}`, 'RUN_NOT_FOUND');
    return run;
  }

  private async requireMutableRun(taskIdInput: string): Promise<DuetRunCheckpointV2> {
    const taskId = this.taskId(taskIdInput);
    return this.store.migrate(taskId);
  }

  private requireNoHalt(run: DuetRunCheckpointV2): void {
    if (run.halt)
      throw new ChatbridgeError('Iteration limit has been reached', 'ITERATION_LIMIT_REACHED');
  }

  private taskId(input: string): string {
    const parsed = TaskIdSchema.safeParse(input);
    if (!parsed.success) throw new ChatbridgeError('Invalid task ID', 'INVALID_TASK_ID');
    return parsed.data;
  }

  private transition(from: TaskState, to: TaskState): void {
    try {
      assertTransition(from, to);
    } catch (error) {
      throw new ChatbridgeError(
        error instanceof Error ? error.message : 'Illegal run transition',
        'RUN_STATE_INVALID',
      );
    }
  }
}

function parseIngestEnvelope(text: string): Envelope {
  try {
    return parseEnvelope(text);
  } catch {
    // Frozen M1 `wait --parse` emits the already validated Envelope as JSON.
  }
  try {
    const parsed = EnvelopeSchema.strict().safeParse(JSON.parse(text));
    if (parsed.success) return parsed.data;
  } catch {
    // Keep malformed input details out of CLI errors.
  }
  throw new Error('Malformed C2C envelope');
}

function planningEnvelope(run: DuetRunCheckpointV2, request: string): string {
  return serializeEnvelope({
    version: 1,
    taskId: run.taskId,
    iteration: run.iteration,
    state: 'PLANNING',
    mode: 'GITHUB',
    repository: run.context.repository,
    taskBranch: run.context.taskBranch,
    baseRef: run.context.baseRef,
    content:
      'Act as Planner and Architect.\n\n' +
      'Read the repository through the GitHub data plane at the supplied immutable BASE_REF.\n\n' +
      `User request:\n${request.trim()}\n\n` +
      'Return only a valid C2C/1 envelope. If implementation can proceed, return STATE: PLAN. ' +
      'If a user decision is required, return STATE: BLOCKED. Do not implement code. ' +
      'Do not review a moving branch. ' +
      'Your response must echo TASK, MODE, REPOSITORY, TASK_BRANCH, and BASE_REF exactly from this request, ' +
      'and must use the expected response ITERATION.',
  });
}

function allowedResponse(from: TaskState, to: TaskState): boolean {
  if (from === 'PLANNING') return ['PLAN', 'BLOCKED', 'FAILED'].includes(to);
  if (from === 'REVIEWING') return ['DONE', 'PLAN', 'BLOCKED', 'FAILED'].includes(to);
  return false;
}

function resumeInstruction(state: TaskState): string {
  const instructions: Record<TaskState, string> = {
    INIT: 'Initialization did not complete; stop and inspect the run.',
    PLANNING: 'Continue Browser Bridge wait, then ingest the planner response.',
    PLAN: 'Run duet begin-execution before modifying code.',
    EXECUTING: 'Run duet reconcile-execution and never replay execution blindly.',
    EXECUTED: 'Resend the durable review envelope, then mark-reviewing after send succeeds.',
    REVIEWING: 'Continue Browser Bridge wait, then ingest the reviewer response.',
    DONE: 'Run is complete; report the durable result.',
    BLOCKED: 'Report the blocking question to the user.',
    FAILED: 'Run failed; stop.',
    CANCELLED: 'Run was cancelled; stop.',
  };
  return instructions[state];
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function previousReviewTarget(run: DuetRunCheckpointV2): GitHubReviewTarget | undefined {
  return [...run.iterations.slice(0, run.iteration - 1)]
    .reverse()
    .find((record) => record.reviewTarget)?.reviewTarget;
}

function executionBase(run: DuetRunCheckpointV2): string {
  if (run.iteration === 1) return run.context.baseRef;
  const previous = previousReviewTarget(run);
  if (!previous)
    throw new ChatbridgeError(
      'Previous iteration review evidence is unavailable',
      'EXECUTION_BASE_MISMATCH',
    );
  return previous.reviewRef;
}

function isCurrentM2Evidence(evidence: TaskCheckpoint, executionBaseRef: string): boolean {
  return (
    evidence.mode === 'GITHUB' &&
    evidence.state === 'EXECUTED' &&
    Boolean(evidence.reviewRef) &&
    evidence.reviewRef !== executionBaseRef
  );
}

function reconciliationIdentity(
  run: DuetRunCheckpointV2,
  workspace: ExecutionWorkspaceState,
  executionBaseRef: string,
): Pick<
  ExecutionReconciliation,
  'taskId' | 'iteration' | 'executionBaseRef' | 'head' | 'clean' | 'conflicted' | 'externalEffects'
> {
  return {
    taskId: run.taskId,
    iteration: run.iteration,
    executionBaseRef,
    head: workspace.head,
    clean: workspace.clean,
    conflicted: workspace.conflicted,
    externalEffects: 'UNVERIFIED',
  };
}

function hasPlan(run: DuetRunCheckpoint): boolean {
  return run.version === 1 ? Boolean(run.plan) : Boolean(run.iterations[run.iteration - 1]);
}

function sameTaskContext(left: TaskContextV1, right: TaskContextV1): boolean {
  return (
    left.version === right.version &&
    left.taskId === right.taskId &&
    left.taskSpecSha256 === right.taskSpecSha256 &&
    left.plannerControlSha256 === right.plannerControlSha256
  );
}

function historySummary(
  run: DuetRunCheckpoint,
): Array<{ iteration: number; reviewRef?: string; testStatus?: TestStatus }> {
  if (run.version === 2)
    return run.iterations.map((record) => ({
      iteration: record.iteration,
      ...(record.reviewTarget
        ? {
            reviewRef: record.reviewTarget.reviewRef,
            testStatus: record.reviewTarget.testStatus,
          }
        : {}),
    }));
  if (!run.plan) return [];
  const reviewIteration =
    run.reviewTarget && run.state === 'PLAN' && run.iteration > 1
      ? run.iteration - 1
      : run.iteration;
  return Array.from({ length: run.iteration }, (_, index) => {
    const iteration = index + 1;
    return {
      iteration,
      ...(run.reviewTarget && iteration === reviewIteration
        ? { reviewRef: run.reviewTarget.reviewRef, testStatus: run.reviewTarget.testStatus }
        : {}),
    };
  });
}
