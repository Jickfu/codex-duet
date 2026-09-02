import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { ChatbridgeError } from '../core/errors.js';
import { DuetRunStore } from './run-store.js';
import { DiscussionStore } from './discussion-store.js';
import {
  DiscussionControlV1Schema,
  DiscussionResponseV1Schema,
  type DiscussionControlV1,
  type DiscussionResponseV1,
} from './discussion.js';
import { TaskInteractionPolicyStore } from './interaction-policy-store.js';
import { TaskSpecStore } from './task-spec-store.js';
import { canonicalJson } from './task-spec.js';

export class DiscussionService {
  constructor(
    private readonly runs: DuetRunStore,
    private readonly policies: TaskInteractionPolicyStore,
    private readonly specs: TaskSpecStore,
    private readonly discussions: DiscussionStore,
  ) {}

  async prepare(
    taskId: string,
    requestFile: string,
    outputFile: string,
  ): Promise<DiscussionControlV1> {
    const [run, policy, spec, summary] = await Promise.all([
      this.runs.read(taskId),
      this.policies.read(taskId),
      this.specs.read(taskId),
      this.discussions.readSummary(taskId),
    ]);
    if (!run || run.state !== 'PLANNING')
      throw new ChatbridgeError('Discussion requires a PLANNING run', 'DISCUSSION_STATE_INVALID');
    if (!policy?.discussion.enabled)
      throw new ChatbridgeError('Discussion is disabled for this task', 'DISCUSSION_DISABLED');
    await this.policies.lock(taskId);
    if (!spec) throw new ChatbridgeError('Discussion requires TaskSpecV1', 'TASK_SPEC_MISSING');
    if (summary && summary.status !== 'ACTIVE')
      throw new ChatbridgeError('Discussion is already terminal', 'DISCUSSION_TERMINAL');
    if (summary && summary.rounds.at(-1)?.outcome !== 'CONTINUE')
      throw new ChatbridgeError(
        'Previous Discussion round has no continuing response',
        'DISCUSSION_RESPONSE_PENDING',
      );
    const round = (summary?.rounds.length ?? 0) + 1;
    if (round > 3)
      throw new ChatbridgeError('Discussion round limit reached', 'DISCUSSION_LIMIT_REACHED');
    const content = (await readFile(requestFile, 'utf8')).trim();
    if (!content)
      throw new ChatbridgeError('Discussion request is empty', 'DISCUSSION_REQUEST_EMPTY');
    const requestSha256 = sha256(content);
    const control = DiscussionControlV1Schema.parse({
      version: 1,
      kind: 'DISCUSSION_CONTROL',
      taskId,
      iteration: run.iteration,
      round,
      provider: policy.browserControlProvider,
      taskSpecSha256: spec.integrity.sha256,
      interactionPolicySha256: sha256(canonicalJson(policy)),
      ...(summary?.rounds.at(-1)?.responseSha256
        ? { previousResponseSha256: summary.rounds.at(-1)!.responseSha256 }
        : {}),
      requestSha256,
      content,
    });
    if (Buffer.byteLength(canonicalJson(control), 'utf8') > 8192)
      throw new ChatbridgeError(
        'Complete Discussion control exceeds 8192 UTF-8 bytes',
        'DISCUSSION_PAYLOAD_TOO_LARGE',
      );
    await this.discussions.createControl(control);
    await this.discussions.writeSummary({
      version: 1,
      taskId,
      provider: policy.browserControlProvider,
      maxRounds: 3,
      rounds: [...(summary?.rounds ?? []), { round, requestSha256 }],
      status: 'ACTIVE',
    });
    await writeFile(outputFile, `${canonicalJson(control)}\n`, 'utf8');
    return control;
  }

  async ingest(taskId: string, responseFile: string): Promise<DiscussionResponseV1> {
    let response: DiscussionResponseV1;
    try {
      response = DiscussionResponseV1Schema.parse(JSON.parse(await readFile(responseFile, 'utf8')));
    } catch {
      throw new ChatbridgeError('Malformed DiscussionResponseV1', 'DISCUSSION_RESPONSE_INVALID');
    }
    if (Buffer.byteLength(canonicalJson(response), 'utf8') > 8192)
      throw new ChatbridgeError(
        'Complete Discussion response exceeds 8192 UTF-8 bytes',
        'DISCUSSION_PAYLOAD_TOO_LARGE',
      );
    const [run, policy, spec, summary] = await Promise.all([
      this.runs.read(taskId),
      this.policies.read(taskId),
      this.specs.read(taskId),
      this.discussions.readSummary(taskId),
    ]);
    if (!run || run.state !== 'PLANNING' || !summary || summary.status !== 'ACTIVE')
      throw new ChatbridgeError('Discussion response is not expected', 'DISCUSSION_STATE_INVALID');
    if (!policy?.discussion.enabled || !spec)
      throw new ChatbridgeError('Discussion authority is unavailable', 'DISCUSSION_STATE_INVALID');
    const expected = summary.rounds.at(-1)!;
    const control = await this.discussions.readControl(taskId, expected.round);
    if (
      response.taskId !== taskId ||
      response.iteration !== run.iteration ||
      response.round !== expected.round ||
      response.provider !== policy.browserControlProvider ||
      response.taskSpecSha256 !== spec.integrity.sha256 ||
      response.controlSha256 !== sha256(canonicalJson(control)) ||
      response.requestSha256 !== control.requestSha256
    )
      throw new ChatbridgeError(
        'Discussion response identity does not match the prepared round',
        'DISCUSSION_IDENTITY_MISMATCH',
      );
    if (response.outcome === 'CONTINUE' && response.round === 3)
      throw new ChatbridgeError('Discussion round limit reached', 'DISCUSSION_LIMIT_REACHED');
    await this.discussions.createResponse(response);
    const status: 'ACTIVE' | 'CONVERGED' | 'BLOCKED' | 'FAILED' =
      response.outcome === 'CONVERGED'
        ? 'CONVERGED'
        : response.outcome === 'USER_DECISION_REQUIRED'
          ? 'BLOCKED'
          : response.outcome === 'FAILED'
            ? 'FAILED'
            : 'ACTIVE';
    const nextSummary = {
      ...summary,
      rounds: summary.rounds.map((round) =>
        round.round === response.round
          ? { ...round, responseSha256: sha256(canonicalJson(response)), outcome: response.outcome }
          : round,
      ),
      status,
    };
    if (status === 'BLOCKED' || status === 'FAILED') {
      const mutable = await this.runs.migrate(taskId);
      await this.runs.write({
        ...mutable,
        state: status === 'BLOCKED' ? 'BLOCKED' : 'FAILED',
        ...(status === 'BLOCKED' ? { blockedPhase: 'PLANNING' as const } : {}),
        updatedAt: new Date().toISOString(),
      });
    }
    await this.discussions.writeSummary(nextSummary);
    return response;
  }

  async assertPlannerAllowed(taskId: string): Promise<void> {
    const policy = await this.policies.read(taskId);
    if (!policy?.discussion.enabled) return;
    const summary = await this.discussions.readSummary(taskId);
    if (summary?.status !== 'CONVERGED')
      throw new ChatbridgeError(
        'Final Planner response is forbidden until Discussion converges',
        'DISCUSSION_NOT_CONVERGED',
      );
  }
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
