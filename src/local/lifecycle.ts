import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { TaskIdSchema } from '../core/domain.js';
import { ChatbridgeError } from '../core/errors.js';
import { StateSchema } from '../core/protocol.js';
import { assertTransition } from '../core/state-machine.js';
import { TaskOperationLock } from '../duet/task-operation-lock.js';
import { ResponseIngressService, type ResponseIngressRequest } from '../duet/response-ingress.js';
import {
  TaskInteractionPolicyV1Schema,
  type TaskInteractionPolicyV1,
} from '../duet/interaction-policy.js';
import { canonicalJson, sha256 } from '../duet/task-spec.js';
import {
  LocalReviewTargetV1Schema,
  Sha256Schema,
  validateLocalReviewTargetIntegrity,
} from './domain.js';
import { localControlEnvelope, validateLocalControlResponse } from './control-projection.js';
import { LocalTaskSpecV1Schema, validateLocalTaskSpec, type LocalTaskSpecV1 } from './task-spec.js';
import type { LocalCodeProvider, LocalSnapshotAuthority } from './local-code-provider.js';

const RunSchema = z
  .object({
    version: z.literal(1),
    mode: z.literal('LOCAL'),
    taskId: TaskIdSchema,
    spec: LocalTaskSpecV1Schema,
    policy: TaskInteractionPolicyV1Schema,
    state: StateSchema,
    iteration: z.number().int().min(1).max(100),
    maxIterations: z.number().int().min(1).max(100),
    control: z.string(),
    confirmed: z.boolean(),
    plan: z.string().optional(),
    reviews: z.array(LocalReviewTargetV1Schema),
    responses: z.array(
      z
        .object({
          controlSha256: Sha256Schema,
          responseSha256: Sha256Schema,
          response: z
            .string()
            .min(1)
            .max(64 * 1024),
          iteration: z.number().int().positive(),
        })
        .strict(),
    ),
  })
  .strict();
export type LocalRunV1 = z.infer<typeof RunSchema>;

/** Implementations must read durable transport/Discussion evidence, never assume a send succeeded. */
export interface LocalLifecycleGates {
  assertPlanningReady(spec: LocalTaskSpecV1, policy: TaskInteractionPolicyV1): Promise<void>;
  assertControlConfirmed(
    taskId: string,
    controlSha256: string,
    policy: TaskInteractionPolicyV1,
  ): Promise<void>;
}

/** Shared C2C transitions and response ingress; no transport, test runner or workspace edits. */
export class LocalLifecycle {
  private readonly ingress: ResponseIngressService;
  private readonly lock: TaskOperationLock;
  constructor(
    private readonly root: string,
    private readonly provider: LocalCodeProvider,
    private readonly snapshots: LocalSnapshotAuthority,
    private readonly gates: LocalLifecycleGates,
  ) {
    this.lock = new TaskOperationLock(root);
    // acceptResponse runs under the ingress task lock. Never acquire it recursively.
    this.ingress = new ResponseIngressService(root, (request) => this.applyResponse(request));
  }

  async init(specInput: LocalTaskSpecV1, policyInput: TaskInteractionPolicyV1, maxIterations = 5) {
    const spec = validateLocalTaskSpec(specInput, specInput.context);
    const policy = TaskInteractionPolicyV1Schema.parse(policyInput);
    if (policy.taskId !== spec.taskId)
      throw new ChatbridgeError('Policy task mismatch', 'TASK_MISMATCH');
    z.number().int().min(1).max(100).parse(maxIterations);
    return this.lock.withLock(spec.taskId, async () => {
      const existing = await this.readOptional(spec.taskId);
      if (existing) {
        if (
          canonicalJson(existing.spec) !== canonicalJson(spec) ||
          canonicalJson(existing.policy) !== canonicalJson(policy) ||
          existing.maxIterations !== maxIterations
        )
          throw new ChatbridgeError('LOCAL run init differs', 'LOCAL_RUN_IMMUTABLE');
        return existing;
      }
      const checkpoint = await this.provider.status(spec.taskId);
      if (
        canonicalJson(checkpoint.context) !== canonicalJson(spec.context) ||
        checkpoint.reviews.length
      )
        throw new ChatbridgeError('LOCAL run baseline mismatch', 'TASK_SPEC_CONTEXT_MISMATCH');
      await this.gates.assertPlanningReady(spec, policy);
      await this.snapshots.assertLiveSnapshot(spec.context.baselineSnapshotId);
      const run: LocalRunV1 = {
        version: 1,
        mode: 'LOCAL',
        taskId: spec.taskId,
        spec,
        policy,
        state: 'PLANNING',
        iteration: 1,
        maxIterations,
        control: localControlEnvelope(spec),
        confirmed: false,
        reviews: [],
        responses: [],
      };
      await this.write(run);
      return run;
    });
  }

  async status(taskId: string): Promise<LocalRunV1> {
    const run = await this.readOptional(taskId);
    if (!run) throw new ChatbridgeError('LOCAL run missing', 'TASK_NOT_FOUND');
    return run;
  }

  async confirmControl(taskId: string) {
    return this.lock.withLock(taskId, async () => {
      const run = await this.status(taskId);
      if (!['PLANNING', 'EXECUTED', 'REVIEWING'].includes(run.state)) this.invalid();
      await this.gates.assertControlConfirmed(taskId, sha256(run.control), run.policy);
      if (run.state === 'EXECUTED') {
        assertTransition(run.state, 'REVIEWING');
        run.state = 'REVIEWING';
      }
      run.confirmed = true;
      await this.write(run);
      return run;
    });
  }

  async beginExecution(taskId: string) {
    return this.lock.withLock(taskId, async () => {
      const run = await this.status(taskId);
      if (run.state === 'EXECUTING') return run; // Durable intent already exists; never reset it.
      if (run.state !== 'PLAN') this.invalid();
      await this.snapshots.assertLiveSnapshot(
        run.reviews.at(-1)?.reviewSnapshotId ?? run.spec.context.baselineSnapshotId,
      );
      assertTransition(run.state, 'EXECUTING');
      run.state = 'EXECUTING';
      await this.write(run);
      return run;
    });
  }

  async prepareReview(taskId: string) {
    return this.lock.withLock(taskId, async () => {
      const run = await this.status(taskId);
      if (['EXECUTED', 'REVIEWING'].includes(run.state)) {
        const recovered = await this.provider.prepareReview({ taskId, iteration: run.iteration });
        if (canonicalJson(recovered) !== canonicalJson(run.reviews.at(-1))) this.invalid();
        return run;
      }
      if (run.state !== 'EXECUTING') this.invalid();
      // Provider publication may precede this write on crash. Its immutable replay completes recovery.
      const target = await this.provider.prepareReview({ taskId, iteration: run.iteration });
      const control = localControlEnvelope(run.spec, target);
      assertTransition(run.state, 'EXECUTED');
      run.state = 'EXECUTED';
      run.control = control;
      run.confirmed = false;
      run.reviews.push(target);
      await this.write(run);
      return run;
    });
  }

  /** Preflight rejects malformed/unbound responses before ingress can reserve a PENDING record. */
  async ingest(request: ResponseIngressRequest) {
    const run = await this.status(request.taskId);
    await this.checkResponse(run, request);
    return this.ingress.accept(request);
  }

  private async checkResponse(run: LocalRunV1, request: ResponseIngressRequest) {
    const previous = run.responses.find((record) => record.controlSha256 === request.controlSha256);
    if (previous) {
      if (previous.iteration !== request.iteration) this.invalid();
      if (previous.responseSha256 !== sha256(request.response))
        throw new ChatbridgeError(
          'Different response already applied',
          'RESPONSE_ALREADY_ACCEPTED',
        );
      return undefined;
    }
    if (
      !run.confirmed ||
      !['PLANNING', 'REVIEWING'].includes(run.state) ||
      request.controlSha256 !== sha256(run.control) ||
      request.iteration !== run.iteration
    )
      this.invalid();
    const envelope = validateLocalControlResponse(
      run.spec,
      request.response,
      run.state === 'REVIEWING' ? run.reviews.at(-1) : undefined,
    );
    if (envelope.state === 'PLAN') {
      if (envelope.iteration > run.maxIterations)
        throw new ChatbridgeError('LOCAL iteration limit reached', 'LOCAL_ITERATION_LIMIT');
      await this.snapshots.assertLiveSnapshot(
        run.reviews.at(-1)?.reviewSnapshotId ?? run.spec.context.baselineSnapshotId,
      );
    }
    return envelope;
  }

  private async applyResponse(request: ResponseIngressRequest) {
    const run = await this.status(request.taskId);
    const envelope = await this.checkResponse(run, request);
    if (!envelope) return; // Checkpoint committed before ingress ACCEPTED: exact retry completes it.
    assertTransition(run.state, envelope.state);
    run.state = envelope.state;
    run.iteration = envelope.iteration;
    if (envelope.state === 'PLAN') run.plan = request.response;
    run.responses.push({
      controlSha256: request.controlSha256,
      responseSha256: sha256(request.response),
      response: request.response,
      iteration: request.iteration,
    });
    await this.write(run);
  }

  private validate(value: unknown, taskId: string): LocalRunV1 {
    const run = RunSchema.parse(value);
    validateLocalTaskSpec(run.spec, run.spec.context);
    if (
      run.taskId !== taskId ||
      run.spec.taskId !== taskId ||
      run.policy.taskId !== taskId ||
      run.iteration > run.maxIterations
    )
      this.invalid();
    run.reviews.forEach((target, index) => {
      validateLocalReviewTargetIntegrity(target);
      if (
        target.iteration !== index + 1 ||
        target.previousReviewSnapshotId !== run.reviews[index - 1]?.reviewSnapshotId ||
        target.taskId !== taskId ||
        target.workspaceId !== run.spec.context.workspaceId ||
        target.baselineSnapshotId !== run.spec.context.baselineSnapshotId
      )
        this.invalid();
    });
    if (
      new Set(run.responses.map((response) => response.controlSha256)).size !== run.responses.length
    )
      this.invalid();
    let lastState: string | undefined;
    let lastPlan: string | undefined;
    let lastIteration = 1;
    run.responses.forEach((record, index) => {
      const target = index ? run.reviews[index - 1] : undefined;
      if (
        (index && (!target || lastState !== 'PLAN')) ||
        record.controlSha256 !== sha256(localControlEnvelope(run.spec, target)) ||
        record.iteration !== (target?.iteration ?? 1) ||
        record.responseSha256 !== sha256(record.response)
      )
        this.invalid();
      const envelope = validateLocalControlResponse(run.spec, record.response, target);
      lastState = envelope.state;
      lastIteration = envelope.iteration;
      if (envelope.state === 'PLAN') lastPlan = record.response;
    });
    if (run.plan !== lastPlan || run.iteration !== lastIteration) this.invalid();
    if (!lastState && run.state !== 'PLANNING') this.invalid();
    if (
      lastState &&
      (lastState === 'PLAN'
        ? !['PLAN', 'EXECUTING', 'EXECUTED', 'REVIEWING'].includes(run.state)
        : run.state !== lastState)
    )
      this.invalid();
    if (run.control !== localControlEnvelope(run.spec, run.reviews.at(-1))) this.invalid();
    if (['PLAN', 'EXECUTING', 'EXECUTED', 'REVIEWING', 'DONE'].includes(run.state) && !run.plan)
      this.invalid();
    if (
      ['EXECUTED', 'REVIEWING', 'DONE'].includes(run.state) &&
      run.reviews.length !== run.iteration
    )
      this.invalid();
    if (['PLAN', 'EXECUTING'].includes(run.state) && run.reviews.length !== run.iteration - 1)
      this.invalid();
    if (
      run.state === 'PLANNING' &&
      (run.iteration !== 1 || run.reviews.length || run.responses.length)
    )
      this.invalid();
    if (run.state === 'EXECUTED' && run.confirmed) this.invalid();
    if (['REVIEWING', 'DONE'].includes(run.state) && !run.confirmed) this.invalid();
    return run;
  }

  private async readOptional(taskId: string) {
    try {
      return this.validate(JSON.parse(await readFile(this.file(taskId), 'utf8')), taskId);
    } catch (error: any) {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    }
  }
  private async write(input: LocalRunV1) {
    const run = this.validate(input, input.taskId);
    const file = this.file(run.taskId);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, canonicalJson(run) + '\n', { flag: 'wx', mode: 0o600 });
      await rename(temporary, file);
    } finally {
      await unlink(temporary).catch((error: any) => {
        if (error?.code !== 'ENOENT') throw error;
      });
    }
  }
  private file(taskId: string) {
    return path.join(this.root, 'runs', TaskIdSchema.parse(taskId), 'local', 'run.json');
  }
  private invalid(): never {
    throw new ChatbridgeError('LOCAL lifecycle authority/state mismatch', 'LOCAL_RUN_INVALID');
  }
}
