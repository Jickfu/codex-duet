import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { TestStatus } from '../core/domain.js';
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

export class DuetOrchestrator {
  constructor(
    private readonly provider: Pick<GitHubCodeProvider, 'prepareContext' | 'getReviewTarget'>,
    private readonly store: DuetRunStore,
    private readonly historyVerifier: ReviewHistoryVerifier,
  ) {}

  async init(
    taskIdInput: string,
    requestFile: string,
    outputFile: string,
    maxIterationsInput = 8,
  ): Promise<DuetRunCheckpointV2> {
    const taskId = this.taskId(taskIdInput);
    if (await this.store.read(taskId))
      throw new ChatbridgeError(`Run already exists for ${taskId}`, 'RUN_ALREADY_EXISTS');
    const request = await readFile(requestFile, 'utf8');
    if (!request.trim()) throw new ChatbridgeError('Request file is empty', 'REQUEST_EMPTY');
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
    await this.store.writeRequestArtifact(taskId, request);
    await this.store.write(run);
    await writeFile(outputFile, planningEnvelope(run, request), 'utf8');
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
    if (envelope.mode !== run.mode)
      throw new ChatbridgeError('C2C mode does not match run', 'MODE_MISMATCH');
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
    const run = await this.requireMutableRun(taskIdInput);
    this.requireNoHalt(run);
    this.transition(run.state, 'EXECUTING');
    const updated = { ...run, state: 'EXECUTING' as const, updatedAt: new Date().toISOString() };
    await this.store.write(updated);
    return updated;
  }

  async prepareReview(
    taskIdInput: string,
    tests: TestStatus,
    outputFile: string,
  ): Promise<DuetRunCheckpointV2> {
    const run = await this.requireMutableRun(taskIdInput);
    this.requireNoHalt(run);
    this.transition(run.state, 'EXECUTED');
    const rawTarget = await this.provider.getReviewTarget(run.taskId, tests);
    if (rawTarget.mode !== 'GITHUB')
      throw new ChatbridgeError('M3.0 supports GITHUB mode only', 'MODE_MISMATCH');
    const reviewTarget = rawTarget as GitHubReviewTarget;
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
    const envelope = previousReviewRef
      ? iterativeReviewEnvelope(reviewTarget, run.iteration, previousReviewRef)
      : githubReviewEnvelope(reviewTarget, run.iteration);
    const current = run.iterations[run.iteration - 1]!;
    const updated: DuetRunCheckpointV2 = {
      ...run,
      state: 'EXECUTED' as const,
      iterations: [...run.iterations.slice(0, -1), { ...current, reviewTarget }],
      updatedAt: new Date().toISOString(),
    };
    await this.store.writeIterationArtifact(
      run.taskId,
      run.iteration,
      'review-envelope.txt',
      envelope,
    );
    await this.store.write(updated);
    await writeFile(outputFile, envelope, 'utf8');
    return updated;
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
          : resumeInstruction(run.state),
    };
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
      'Do not review a moving branch.',
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
    EXECUTING: 'EXECUTION_RECOVERY_REQUIRED',
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

function hasPlan(run: DuetRunCheckpoint): boolean {
  return run.version === 1 ? Boolean(run.plan) : Boolean(run.iterations[run.iteration - 1]);
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
