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
import type { DuetRunCheckpointV1 } from './run.js';
import { DuetRunStore } from './run-store.js';

export class DuetOrchestrator {
  constructor(
    private readonly provider: Pick<GitHubCodeProvider, 'prepareContext' | 'getReviewTarget'>,
    private readonly store: DuetRunStore,
  ) {}

  async init(
    taskIdInput: string,
    requestFile: string,
    outputFile: string,
  ): Promise<DuetRunCheckpointV1> {
    const taskId = this.taskId(taskIdInput);
    if (await this.store.read(taskId))
      throw new ChatbridgeError(`Run already exists for ${taskId}`, 'RUN_ALREADY_EXISTS');
    const request = await readFile(requestFile, 'utf8');
    if (!request.trim()) throw new ChatbridgeError('Request file is empty', 'REQUEST_EMPTY');
    const rawContext = await this.provider.prepareContext(taskId);
    if (rawContext.mode !== 'GITHUB')
      throw new ChatbridgeError('M3.0 supports GITHUB mode only', 'MODE_MISMATCH');
    const context = rawContext as GitHubContextRef;
    assertTransition('INIT', 'PLANNING');
    const now = new Date().toISOString();
    const run: DuetRunCheckpointV1 = {
      version: 1,
      taskId,
      mode: 'GITHUB',
      iteration: 1,
      state: 'PLANNING',
      context,
      request: { sha256: sha256(request) },
      createdAt: now,
      updatedAt: now,
    };
    await this.store.writeArtifact(taskId, 'request.md', request);
    await this.store.write(run);
    await writeFile(outputFile, planningEnvelope(run, request), 'utf8');
    return run;
  }

  async ingest(taskIdInput: string, messageFile: string): Promise<DuetRunCheckpointV1> {
    const run = await this.requireRun(taskIdInput);
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
    const updated: DuetRunCheckpointV1 = {
      ...run,
      iteration: envelope.state === 'PLAN' ? envelope.iteration : run.iteration,
      state: envelope.state,
      updatedAt: new Date().toISOString(),
      ...(envelope.state === 'BLOCKED'
        ? { blockedPhase: run.state as 'PLANNING' | 'REVIEWING' }
        : {}),
    };
    if (envelope.state === 'PLAN') {
      await this.store.writeArtifact(run.taskId, 'plan.md', envelope.content);
      updated.plan = { sha256: sha256(envelope.content) };
      delete updated.blockedPhase;
    }
    await this.store.write(updated);
    return updated;
  }

  async beginExecution(taskIdInput: string): Promise<DuetRunCheckpointV1> {
    const run = await this.requireRun(taskIdInput);
    this.transition(run.state, 'EXECUTING');
    const updated = { ...run, state: 'EXECUTING' as const, updatedAt: new Date().toISOString() };
    await this.store.write(updated);
    return updated;
  }

  async prepareReview(
    taskIdInput: string,
    tests: TestStatus,
    outputFile: string,
  ): Promise<DuetRunCheckpointV1> {
    const run = await this.requireRun(taskIdInput);
    this.transition(run.state, 'EXECUTED');
    const rawTarget = await this.provider.getReviewTarget(run.taskId, tests);
    if (rawTarget.mode !== 'GITHUB')
      throw new ChatbridgeError('M3.0 supports GITHUB mode only', 'MODE_MISMATCH');
    const reviewTarget = rawTarget as GitHubReviewTarget;
    const envelope = githubReviewEnvelope(reviewTarget, run.iteration);
    const updated = {
      ...run,
      state: 'EXECUTED' as const,
      reviewTarget,
      updatedAt: new Date().toISOString(),
    };
    await this.store.writeArtifact(run.taskId, 'review-envelope.txt', envelope);
    await this.store.write(updated);
    await writeFile(outputFile, envelope, 'utf8');
    return updated;
  }

  async markReviewing(taskIdInput: string): Promise<DuetRunCheckpointV1> {
    const run = await this.requireRun(taskIdInput);
    this.transition(run.state, 'REVIEWING');
    const updated = { ...run, state: 'REVIEWING' as const, updatedAt: new Date().toISOString() };
    await this.store.write(updated);
    return updated;
  }

  async status(
    taskIdInput: string,
  ): Promise<DuetRunCheckpointV1 & { resume: string; reviewEnvelope?: string }> {
    const run = await this.requireRun(taskIdInput);
    return {
      ...run,
      resume: resumeInstruction(run.state),
      ...(run.state === 'EXECUTED'
        ? { reviewEnvelope: this.store.artifactPath(run.taskId, 'review-envelope.txt') }
        : {}),
    };
  }

  private async requireRun(taskIdInput: string): Promise<DuetRunCheckpointV1> {
    const taskId = this.taskId(taskIdInput);
    const run = await this.store.read(taskId);
    if (!run) throw new ChatbridgeError(`Run not found for ${taskId}`, 'RUN_NOT_FOUND');
    return run;
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

function planningEnvelope(run: DuetRunCheckpointV1, request: string): string {
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
