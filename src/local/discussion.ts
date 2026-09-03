import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { TaskIdSchema } from '../core/domain.js';
import { ChatbridgeError } from '../core/errors.js';
import { ConversationUrlPolicy } from '../browser/conversation-url.js';
import { CodexBrowserControlStore } from '../duet/codex-browser-control-store.js';
import { DiscussionStore } from '../duet/discussion-store.js';
import {
  DiscussionControlV1Schema,
  DiscussionResponseV1Schema,
  type DiscussionControlV1,
  type DiscussionResponseV1,
  type DiscussionSummaryV1,
} from '../duet/discussion.js';
import { TaskInteractionPolicyStore } from '../duet/interaction-policy-store.js';
import { TaskOperationLock } from '../duet/task-operation-lock.js';
import { canonicalJson, sha256 } from '../duet/task-spec.js';
import { assertLocalContracts, LocalTaskSpecStore } from './task-spec.js';
import type { GitLocalSnapshotAuthority } from './git-snapshot-authority.js';
import type { LocalCodeProvider } from './local-code-provider.js';

type Round = { control: DiscussionControlV1; response?: DiscussionResponseV1 };

/** Pre-run LOCAL Discussion. Immutable round files are recovery authority, not a mutable summary. */
export class LocalDiscussion {
  private readonly lock: TaskOperationLock;
  private readonly store: DiscussionStore;
  constructor(
    private readonly root: string,
    private readonly provider: LocalCodeProvider,
    private readonly snapshots: GitLocalSnapshotAuthority,
  ) {
    this.lock = new TaskOperationLock(root);
    this.store = new DiscussionStore(root);
  }

  private async authority(taskId: string) {
    const context = (await this.provider.status(taskId)).context;
    const spec = await new LocalTaskSpecStore(this.root).read(context);
    const policies = new TaskInteractionPolicyStore(this.root);
    const policy = await policies.read(taskId);
    if (!policy?.discussion.enabled) this.fail('DISCUSSION_DISABLED');
    if (policy.browserControlProvider !== 'CODEX_BROWSER')
      this.fail('LOCAL_TRANSPORT_PROOF_UNAVAILABLE');
    await assertLocalContracts(spec, this.snapshots.store);
    return { spec, policy, policies };
  }

  async prepare(taskInput: string, roundInput: number, question: string) {
    const taskId = TaskIdSchema.parse(taskInput);
    const round = z.number().int().min(1).max(3).parse(roundInput);
    if (!question.trim()) this.fail('DISCUSSION_REQUEST_EMPTY');
    return this.lock.withLock(taskId, async () => {
      const authority = await this.authority(taskId);
      const { spec, policy, policies } = authority;
      const history = await this.history(taskId, authority);
      const content = canonicalJson({
        context: spec.context,
        question: question.trim(),
        task: {
          objective: spec.objective,
          scope: spec.scope,
          acceptanceCriteria: spec.acceptanceCriteria,
          exactLiterals: spec.exactLiterals,
          protocolRequirements: spec.protocolRequirements,
          ...(spec.guidance ? { guidance: spec.guidance } : {}),
        },
        instructions:
          'Discuss architecture only. Read source via LOCAL MCP at the exact baseline snapshot. Do not edit or execute commands. Return DiscussionResponseV1 JSON echoing task, iteration, round, provider, taskSpecSha256, controlSha256 (canonical control without terminal newline) and requestSha256. outcome is CONTINUE, CONVERGED, USER_DECISION_REQUIRED or FAILED; content is a nonempty string.',
      });
      const previous = history[round - 2]?.response;
      const control = DiscussionControlV1Schema.parse({
        version: 1,
        kind: 'DISCUSSION_CONTROL',
        taskId,
        iteration: 1,
        round,
        provider: policy.browserControlProvider,
        taskSpecSha256: spec.integrity.sha256,
        interactionPolicySha256: sha256(canonicalJson(policy)),
        ...(previous ? { previousResponseSha256: sha256(canonicalJson(previous)) } : {}),
        requestSha256: sha256(content),
        content,
      });
      this.bound(canonicalJson(control) + '\n');
      const existing = history[round - 1];
      if (existing) {
        if (canonicalJson(existing.control) !== canonicalJson(control))
          this.fail('DISCUSSION_ARTIFACT_IMMUTABLE');
        await this.store.writeSummary(this.summary(taskId, history));
        return control;
      }
      if (
        round !== history.length + 1 ||
        (history.length && history.at(-1)?.response?.outcome !== 'CONTINUE')
      )
        this.fail('DISCUSSION_RESPONSE_PENDING');
      await this.assertPreRun(taskId);
      await policies.lock(taskId);
      await this.snapshots.assertLiveSnapshot(spec.context.baselineSnapshotId);
      // If the summary write is interrupted, the immutable control recovers this same round.
      await this.store.createControl(control);
      await this.store.writeSummary(this.summary(taskId, [...history, { control }]));
      return control;
    });
  }

  async ingest(taskInput: string, rawResponse: string) {
    const taskId = TaskIdSchema.parse(taskInput);
    this.bound(rawResponse);
    const response = DiscussionResponseV1Schema.parse(JSON.parse(rawResponse));
    if (response.taskId !== taskId) this.fail('DISCUSSION_IDENTITY_MISMATCH');
    return this.lock.withLock(taskId, async () => {
      const authority = await this.authority(taskId);
      const history = await this.history(taskId, authority);
      const entry = history[response.round - 1];
      if (!entry) this.fail('DISCUSSION_STATE_INVALID');
      this.assertResponse(entry.control, response);
      const artifact = await this.browserArtifact(entry.control);
      if (artifact !== rawResponse) this.fail('CODEX_BROWSER_RESPONSE_MISMATCH');
      if (entry.response) {
        if (canonicalJson(entry.response) !== canonicalJson(response))
          this.fail('DISCUSSION_ARTIFACT_IMMUTABLE');
        await this.store.writeSummary(this.summary(taskId, history));
        return response;
      }
      if (response.round !== history.length) this.fail('DISCUSSION_STATE_INVALID');
      await this.assertPreRun(taskId);
      await authority.policies.lock(taskId);
      const current = await new CodexBrowserControlStore(this.root).read(taskId);
      if (
        !current ||
        current.operation.state !== 'RESPONDED' ||
        current.operation.kind !== 'DISCUSSION' ||
        current.operation.iteration !== 1 ||
        current.operation.round !== response.round ||
        current.operation.outboundSha256 !== sha256(canonicalJson(entry.control) + '\n') ||
        current.operation.operationId !== this.operationId(entry.control) ||
        current.operation.inboundSha256 !== sha256(rawResponse) ||
        !current.conversationUrl
      )
        this.fail('CODEX_BROWSER_RESPONSE_MISMATCH');
      new ConversationUrlPolicy(['https://chatgpt.com']).canonicalizeStable(
        current.conversationUrl,
      );
      await this.snapshots.assertLiveSnapshot(authority.spec.context.baselineSnapshotId);
      // Response publication is the acceptance point; summary is a recoverable projection.
      await this.store.createResponse(response);
      entry.response = response;
      await this.store.writeSummary(this.summary(taskId, history));
      return response;
    });
  }

  async status(taskInput: string) {
    const taskId = TaskIdSchema.parse(taskInput);
    return this.lock.withLock(taskId, async () => {
      return this.summary(taskId, await this.history(taskId, await this.authority(taskId)));
    });
  }

  async recover(taskInput: string) {
    const taskId = TaskIdSchema.parse(taskInput);
    return this.lock.withLock(taskId, async () => {
      const summary = this.summary(
        taskId,
        await this.history(taskId, await this.authority(taskId)),
      );
      await this.store.writeSummary(summary);
      return summary;
    });
  }

  private async history(
    taskId: string,
    authority: Awaited<ReturnType<LocalDiscussion['authority']>>,
  ) {
    const history: Round[] = [];
    let gap = false;
    for (let round = 1; round <= 3; round++) {
      const control = await this.optional(() => this.store.readControl(taskId, round));
      const response = await this.optional(async () =>
        DiscussionResponseV1Schema.parse(
          JSON.parse(
            await readFile(
              path.join(this.root, 'runs', taskId, 'discussion', `round-${round}`, 'response.json'),
              'utf8',
            ),
          ),
        ),
      );
      if (!control) {
        if (response) this.fail('DISCUSSION_IDENTITY_MISMATCH');
        gap = true;
        continue;
      }
      if (gap || (history.length && history.at(-1)?.response?.outcome !== 'CONTINUE'))
        this.fail('DISCUSSION_IDENTITY_MISMATCH');
      const { spec, policy } = authority;
      this.bound(canonicalJson(control) + '\n');
      const previous = history.at(-1)?.response;
      if (
        control.taskId !== taskId ||
        control.round !== round ||
        control.iteration !== 1 ||
        control.provider !== policy.browserControlProvider ||
        control.taskSpecSha256 !== spec.integrity.sha256 ||
        control.interactionPolicySha256 !== sha256(canonicalJson(policy)) ||
        control.requestSha256 !== sha256(control.content) ||
        control.previousResponseSha256 !== (previous ? sha256(canonicalJson(previous)) : undefined)
      )
        this.fail('DISCUSSION_IDENTITY_MISMATCH');
      if (response) {
        this.assertResponse(control, response);
        const raw = await this.browserArtifact(control);
        this.bound(raw);
        if (
          canonicalJson(DiscussionResponseV1Schema.parse(JSON.parse(raw))) !==
          canonicalJson(response)
        )
          this.fail('CODEX_BROWSER_RESPONSE_MISMATCH');
      }
      history.push({ control, ...(response ? { response } : {}) });
    }
    // A stale prefix is recoverable, but a summary must never claim unproven rounds/outcomes.
    const stored = await this.store.readSummary(taskId);
    if (stored) {
      const derived = this.summary(taskId, history);
      if (stored.provider !== derived.provider || stored.rounds.length > history.length)
        this.fail('DISCUSSION_IDENTITY_MISMATCH');
      stored.rounds.forEach((record, index) => {
        const actual = derived.rounds[index];
        if (
          !actual ||
          record.round !== actual.round ||
          record.requestSha256 !== actual.requestSha256 ||
          (record.responseSha256 !== undefined &&
            record.responseSha256 !== actual.responseSha256) ||
          (record.outcome !== undefined && record.outcome !== actual.outcome)
        )
          this.fail('DISCUSSION_IDENTITY_MISMATCH');
      });
      if (stored.status !== 'ACTIVE' && canonicalJson(stored) !== canonicalJson(derived))
        this.fail('DISCUSSION_IDENTITY_MISMATCH');
    }
    return history;
  }

  private assertResponse(control: DiscussionControlV1, response: DiscussionResponseV1) {
    this.bound(canonicalJson(response));
    if (
      response.taskId !== control.taskId ||
      response.iteration !== 1 ||
      response.round !== control.round ||
      response.provider !== control.provider ||
      response.taskSpecSha256 !== control.taskSpecSha256 ||
      response.controlSha256 !== sha256(canonicalJson(control)) ||
      response.requestSha256 !== control.requestSha256
    )
      this.fail('DISCUSSION_IDENTITY_MISMATCH');
    if (response.round === 3 && response.outcome === 'CONTINUE')
      this.fail('DISCUSSION_LIMIT_REACHED');
  }
  private summary(taskId: string, history: Round[]): DiscussionSummaryV1 {
    const outcome = history.at(-1)?.response?.outcome;
    return {
      version: 1,
      taskId,
      provider: 'CODEX_BROWSER',
      maxRounds: 3,
      status:
        outcome === 'CONVERGED'
          ? 'CONVERGED'
          : outcome === 'USER_DECISION_REQUIRED'
            ? 'BLOCKED'
            : outcome === 'FAILED'
              ? 'FAILED'
              : 'ACTIVE',
      rounds: history.map(({ control, response }) => ({
        round: control.round,
        requestSha256: control.requestSha256,
        ...(response
          ? { responseSha256: sha256(canonicalJson(response)), outcome: response.outcome }
          : {}),
      })),
    };
  }
  private operationId(control: DiscussionControlV1) {
    return sha256(
      JSON.stringify({
        taskId: control.taskId,
        kind: 'DISCUSSION',
        iteration: 1,
        round: control.round,
        outboundSha256: sha256(canonicalJson(control) + '\n'),
      }),
    );
  }
  private browserArtifact(control: DiscussionControlV1) {
    return readFile(
      path.join(
        this.root,
        'runs',
        control.taskId,
        'codex-browser',
        this.operationId(control),
        'response.txt',
      ),
      'utf8',
    );
  }
  private async assertPreRun(taskId: string) {
    if ((await this.provider.status(taskId)).reviews.length) this.fail('DISCUSSION_STATE_INVALID');
    for (const file of [
      path.join(this.root, 'runs', `${taskId}.json`),
      path.join(this.root, 'runs', taskId, 'local', 'run.json'),
    ]) {
      const exists = await this.optional(async () => {
        await access(file);
        return true;
      });
      if (exists) this.fail('DISCUSSION_STATE_INVALID');
    }
  }
  private async optional<T>(read: () => Promise<T>): Promise<T | undefined> {
    try {
      return await read();
    } catch (error: any) {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    }
  }
  private bound(text: string) {
    if (Buffer.byteLength(text, 'utf8') > 8192) this.fail('DISCUSSION_PAYLOAD_TOO_LARGE');
  }
  private fail(code: string): never {
    throw new ChatbridgeError('LOCAL Discussion authority is missing or inconsistent', code);
  }
}
