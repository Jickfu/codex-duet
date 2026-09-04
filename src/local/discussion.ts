import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { TaskIdSchema } from '../core/domain.js';
import { ChatbridgeError } from '../core/errors.js';
import { ConversationUrlPolicy } from '../browser/conversation-url.js';
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
import { assertLocalContracts, LocalTaskSpecStore, type LocalTaskSpecV1 } from './task-spec.js';
import type { TaskInteractionPolicyV1 } from '../duet/interaction-policy.js';
import { LocalDecisionInputSchema, type LocalDecisionInput } from './user-decision.js';
import {
  DiscussionDecisionStore,
  discussionDecisionHash,
  type DiscussionDecision,
} from './discussion-decision.js';
import type { GitLocalSnapshotAuthority } from './git-snapshot-authority.js';
import type { LocalCodeProvider } from './local-code-provider.js';
import { localBrowserRecord, localBrowserResponsePath } from './browser-evidence.js';

type Round = { control: DiscussionControlV1; response?: DiscussionResponseV1 };
type Authority = {
  spec: LocalTaskSpecV1;
  policy: TaskInteractionPolicyV1;
  policies: TaskInteractionPolicyStore;
  supplement?: DiscussionDecision | undefined;
};
const SUPPLEMENT_QUESTION =
  'Continue discussion using the explicit user decision; preserve all accepted task requirements.';

/** Pre-run LOCAL Discussion. Immutable round files are recovery authority, not a mutable summary. */
export class LocalDiscussion {
  private readonly lock: TaskOperationLock;
  private readonly store: DiscussionStore;
  constructor(
    private readonly root: string,
    private readonly provider?: LocalCodeProvider,
    private readonly snapshots?: GitLocalSnapshotAuthority,
    private readonly segment: 'primary' | 'supplement' = 'primary',
  ) {
    this.lock = new TaskOperationLock(root);
    this.store = new DiscussionStore(
      root,
      segment === 'supplement' ? 'local-supplement' : undefined,
    );
  }

  private runtime() {
    if (!this.provider || !this.snapshots) this.fail('DISCUSSION_READ_ONLY');
    return { provider: this.provider, snapshots: this.snapshots };
  }
  private async authority(taskId: string): Promise<Authority> {
    const { provider, snapshots } = this.runtime();
    const context = (await provider.status(taskId)).context;
    const spec = await new LocalTaskSpecStore(this.root).read(context);
    const policies = new TaskInteractionPolicyStore(this.root);
    const policy = await policies.read(taskId);
    if (!policy?.discussion.enabled) this.fail('DISCUSSION_DISABLED');
    await assertLocalContracts(spec, snapshots.store);
    const authority: Authority = { spec, policy, policies };
    if (this.segment === 'supplement') {
      authority.supplement = await this.supplementDecision(taskId, authority);
      if (!authority.supplement) this.fail('DISCUSSION_USER_DECISION_REQUIRED');
    }
    return authority;
  }

  async prepare(taskInput: string, roundInput: number, question: string) {
    const taskId = TaskIdSchema.parse(taskInput);
    const round = z.number().int().min(1).max(3).parse(roundInput);
    if (!question.trim()) this.fail('DISCUSSION_REQUEST_EMPTY');
    return this.lock.withLock(taskId, async () => {
      const authority = await this.authority(taskId);
      const { spec, policies } = authority;
      const history = await this.history(taskId, authority);
      if (this.segment === 'supplement' && round === 1 && question.trim() !== SUPPLEMENT_QUESTION)
        this.fail('DISCUSSION_ARTIFACT_IMMUTABLE');
      const control = this.project(taskId, round, question, authority, history);
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
      await this.runtime().snapshots.assertLiveSnapshot(spec.context.baselineSnapshotId);
      await this.store.createControl(control);
      await this.store.writeSummary(this.summary(taskId, [...history, { control }]));
      return control;
    });
  }

  private project(
    taskId: string,
    round: number,
    question: string,
    authority: Authority,
    history: Round[],
  ) {
    const { spec, policy, supplement } = authority;
    const content = canonicalJson({
      context: spec.context,
      question: question.trim(),
      ...(supplement
        ? {
            supplement,
            supplementRules:
              'This is the only user-authorized supplemental discussion, limited to three rounds. The decision only clarifies unchanged task requirements. If it conflicts with scope or requirements, return USER_DECISION_REQUIRED and require a new task. Never restart automatically or authorize execution.',
          }
        : {}),
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
      ...(previous
        ? { previousResponseSha256: sha256(canonicalJson(previous)) }
        : supplement
          ? { previousResponseSha256: supplement.blockedResponseSha256 }
          : {}),
      requestSha256: sha256(content),
      content,
    });
    this.bound(canonicalJson(control) + '\n');
    return control;
  }

  async resume(taskInput: string, input: LocalDecisionInput) {
    const taskId = TaskIdSchema.parse(taskInput);
    const request = LocalDecisionInputSchema.parse(input);
    if (this.segment !== 'primary') this.fail('DISCUSSION_SUPPLEMENT_IMMUTABLE');
    await this.lock.withLock(taskId, async () => {
      const authority = await this.authority(taskId);
      const existing = await this.supplementDecision(taskId, authority);
      if (existing) {
        if (
          existing.blockedControlSha256 !== request.blockedControlSha256 ||
          existing.decision !== request.decision
        )
          this.fail('DISCUSSION_SUPPLEMENT_IMMUTABLE');
        return;
      }
      const history = await this.history(taskId, authority);
      const blocked = history.at(-1);
      if (
        blocked?.response?.outcome !== 'USER_DECISION_REQUIRED' ||
        sha256(canonicalJson(blocked.control) + '\n') !== request.blockedControlSha256
      )
        this.fail('DISCUSSION_USER_DECISION_REQUIRED');
      const content = {
        version: 1 as const,
        taskId,
        ...request,
        taskSpecSha256: authority.spec.integrity.sha256,
        interactionPolicySha256: sha256(canonicalJson(authority.policy)),
        baselineSnapshotId: authority.spec.context.baselineSnapshotId,
        blockedResponseSha256: sha256(canonicalJson(blocked.response)),
        blockedRound: blocked.control.round,
        blockedResult: blocked.response.content,
        recordedAt: new Date().toISOString(),
      };
      const decision = { ...content, decisionSha256: discussionDecisionHash(content) };
      this.project(taskId, 1, SUPPLEMENT_QUESTION, { ...authority, supplement: decision }, []);
      await this.assertPreRun(taskId);
      await authority.policies.lock(taskId);
      await this.runtime().snapshots.assertLiveSnapshot(authority.spec.context.baselineSnapshotId);
      await new DiscussionDecisionStore(this.root).create(decision);
    });
    // A crash after decision publication is recoverable using this same explicit request.
    return new LocalDiscussion(this.root, this.provider, this.snapshots, 'supplement').prepare(
      taskId,
      1,
      SUPPLEMENT_QUESTION,
    );
  }

  /** Evidence-only gate: caller already owns lifecycle locking; no source runtime or writes. */
  async assertConverged(spec: LocalTaskSpecV1, policy: TaskInteractionPolicyV1) {
    const authority: Authority = {
      spec,
      policy,
      policies: new TaskInteractionPolicyStore(this.root),
    };
    const supplement = await this.supplementDecision(spec.taskId, authority);
    const reader = new LocalDiscussion(
      this.root,
      undefined,
      undefined,
      supplement ? 'supplement' : 'primary',
    );
    const history = await reader.history(spec.taskId, { ...authority, supplement });
    const derived = reader.summary(spec.taskId, history);
    if (
      derived.status !== 'CONVERGED' ||
      canonicalJson(await reader.store.readSummary(spec.taskId)) !== canonicalJson(derived)
    )
      this.fail('DISCUSSION_NOT_CONVERGED');
    return supplement;
  }

  private async supplementDecision(taskId: string, authority: Authority) {
    const decision = await new DiscussionDecisionStore(this.root).read(taskId);
    if (!decision) {
      const directory = path.join(this.root, 'runs', taskId, 'discussion', 'local-supplement');
      for (const suffix of [
        'summary.json',
        ...[1, 2, 3].flatMap((n) => [`round-${n}/request.json`, `round-${n}/response.json`]),
      ]) {
        if (
          await this.optional(async () => {
            await access(path.join(directory, suffix));
            return true;
          })
        )
          this.fail('DISCUSSION_DECISION_INVALID');
      }
      return undefined;
    }
    const primary = new LocalDiscussion(this.root);
    const history = await primary.history(taskId, authority);
    const blocked = history.at(-1);
    if (
      blocked?.response?.outcome !== 'USER_DECISION_REQUIRED' ||
      decision.taskSpecSha256 !== authority.spec.integrity.sha256 ||
      decision.interactionPolicySha256 !== sha256(canonicalJson(authority.policy)) ||
      decision.baselineSnapshotId !== authority.spec.context.baselineSnapshotId ||
      decision.blockedRound !== blocked.control.round ||
      decision.blockedResult !== blocked.response.content ||
      decision.blockedControlSha256 !== sha256(canonicalJson(blocked.control) + '\n') ||
      decision.blockedResponseSha256 !== sha256(canonicalJson(blocked.response))
    )
      this.fail('DISCUSSION_DECISION_INVALID');
    return decision;
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
      const current = await localBrowserRecord(
        this.root,
        taskId,
        authority.policy.browserControlProvider,
      );
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
      await this.runtime().snapshots.assertLiveSnapshot(authority.spec.context.baselineSnapshotId);
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
      const authority = await this.authority(taskId);
      return this.summary(
        taskId,
        await this.history(taskId, authority),
        authority.policy.browserControlProvider,
      );
    });
  }

  /** Exact transport input; caller owns the task lock, so no recursive locking here. */
  async outbound(taskInput: string, roundInput: number) {
    const taskId = TaskIdSchema.parse(taskInput);
    const round = z.number().int().min(1).max(3).parse(roundInput);
    const authority = await this.authority(taskId);
    const history = await this.history(taskId, authority);
    const entry = history.at(-1);
    if (!entry || entry.control.round !== round || entry.response)
      this.fail('DISCUSSION_RESPONSE_PENDING');
    await this.assertPreRun(taskId);
    await authority.policies.lock(taskId);
    await this.runtime().snapshots.assertLiveSnapshot(authority.spec.context.baselineSnapshotId);
    return canonicalJson(entry.control) + '\n';
  }

  async recover(taskInput: string) {
    const taskId = TaskIdSchema.parse(taskInput);
    return this.lock.withLock(taskId, async () => {
      const authority = await this.authority(taskId);
      const summary = this.summary(
        taskId,
        await this.history(taskId, authority),
        authority.policy.browserControlProvider,
      );
      await this.store.writeSummary(summary);
      return summary;
    });
  }

  private async history(taskId: string, authority: Authority) {
    const history: Round[] = [];
    let gap = false;
    for (let round = 1; round <= 3; round++) {
      const control = await this.optional(() => this.store.readControl(taskId, round));
      const response = await this.optional(async () =>
        DiscussionResponseV1Schema.parse(
          JSON.parse(
            await readFile(
              path.join(
                this.root,
                'runs',
                taskId,
                'discussion',
                this.segment === 'supplement' ? 'local-supplement' : '',
                `round-${round}`,
                'response.json',
              ),
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
      if (this.segment === 'supplement') {
        const question: unknown = JSON.parse(control.content).question;
        if (
          typeof question !== 'string' ||
          (round === 1 && question !== SUPPLEMENT_QUESTION) ||
          canonicalJson(control) !==
            canonicalJson(this.project(taskId, round, question, authority, history))
        )
          this.fail('DISCUSSION_IDENTITY_MISMATCH');
      }
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
        control.previousResponseSha256 !==
          (previous
            ? sha256(canonicalJson(previous))
            : authority.supplement?.blockedResponseSha256) ||
        (this.segment === 'supplement' &&
          canonicalJson(JSON.parse(control.content).supplement) !==
            canonicalJson(authority.supplement))
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
      const derived = this.summary(taskId, history, authority.policy.browserControlProvider);
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
  private summary(
    taskId: string,
    history: Round[],
    provider: TaskInteractionPolicyV1['browserControlProvider'] = 'CODEX_BROWSER',
  ): DiscussionSummaryV1 {
    const outcome = history.at(-1)?.response?.outcome;
    return {
      version: 1,
      taskId,
      provider: history[0]?.control.provider ?? provider,
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
      localBrowserResponsePath(
        this.root,
        control.taskId,
        control.provider,
        this.operationId(control),
      ),
      'utf8',
    );
  }
  private async assertPreRun(taskId: string) {
    if ((await this.runtime().provider.status(taskId)).reviews.length)
      this.fail('DISCUSSION_STATE_INVALID');
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
