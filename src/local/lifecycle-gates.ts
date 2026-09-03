import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ChatbridgeError } from '../core/errors.js';
import { parseEnvelope } from '../core/protocol.js';
import { ConversationUrlPolicy } from '../browser/conversation-url.js';
import { CodexBrowserControlStore } from '../duet/codex-browser-control-store.js';
import { DiscussionStore } from '../duet/discussion-store.js';
import { DiscussionResponseV1Schema } from '../duet/discussion.js';
import { TaskInteractionPolicyStore } from '../duet/interaction-policy-store.js';
import type { TaskInteractionPolicyV1 } from '../duet/interaction-policy.js';
import type { ResponseIngressRequest } from '../duet/response-ingress.js';
import { canonicalJson, sha256 } from '../duet/task-spec.js';
import type { LocalLifecycleGates } from './lifecycle.js';
import { LocalSnapshotStore } from './snapshot-store.js';
import { LocalTaskSpecStore, assertLocalContracts, type LocalTaskSpecV1 } from './task-spec.js';

export class StoredLocalLifecycleGates implements LocalLifecycleGates {
  constructor(private readonly root: string) {}

  private async assertPolicy(policy: TaskInteractionPolicyV1) {
    const store = new TaskInteractionPolicyStore(this.root);
    const current = await store.read(policy.taskId);
    if (canonicalJson(current) !== canonicalJson(policy))
      this.denied('INTERACTION_POLICY_IMMUTABLE');
    // The old Playwright marker has no outbound digest and cannot prove this exact control.
    if (policy.browserControlProvider !== 'CODEX_BROWSER')
      this.denied('LOCAL_TRANSPORT_PROOF_UNAVAILABLE');
    await store.lock(policy.taskId);
  }

  async assertPlanningReady(spec: LocalTaskSpecV1, policy: TaskInteractionPolicyV1) {
    await this.assertPolicy(policy);
    const stored = await new LocalTaskSpecStore(this.root).read(spec.context);
    if (canonicalJson(stored) !== canonicalJson(spec)) this.denied('TASK_SPEC_CONTEXT_MISMATCH');
    await assertLocalContracts(spec, new LocalSnapshotStore(this.root));
    if (!policy.discussion.enabled) return;
    const discussions = new DiscussionStore(this.root);
    const summary = await discussions.readSummary(spec.taskId);
    if (
      !summary ||
      summary.status !== 'CONVERGED' ||
      summary.provider !== policy.browserControlProvider ||
      !summary.rounds.length ||
      summary.rounds.length > 3
    )
      this.denied('DISCUSSION_NOT_CONVERGED');
    let previous: string | undefined;
    for (let index = 0; index < summary.rounds.length; index++) {
      const round = summary.rounds[index]!;
      if (round.round !== index + 1) this.denied('DISCUSSION_IDENTITY_MISMATCH');
      const control = await discussions.readControl(spec.taskId, round.round);
      const response = DiscussionResponseV1Schema.parse(
        JSON.parse(
          await readFile(
            path.join(
              this.root,
              'runs',
              spec.taskId,
              'discussion',
              `round-${round.round}`,
              'response.json',
            ),
            'utf8',
          ),
        ),
      );
      const outcome = index === summary.rounds.length - 1 ? 'CONVERGED' : 'CONTINUE';
      if (
        control.taskId !== spec.taskId ||
        control.iteration !== 1 ||
        control.round !== round.round ||
        control.provider !== policy.browserControlProvider ||
        control.taskSpecSha256 !== spec.integrity.sha256 ||
        control.interactionPolicySha256 !== sha256(canonicalJson(policy)) ||
        control.previousResponseSha256 !== previous ||
        control.requestSha256 !== sha256(control.content) ||
        round.requestSha256 !== control.requestSha256 ||
        response.taskId !== spec.taskId ||
        response.iteration !== 1 ||
        response.round !== round.round ||
        response.provider !== policy.browserControlProvider ||
        response.taskSpecSha256 !== spec.integrity.sha256 ||
        response.controlSha256 !== sha256(canonicalJson(control)) ||
        response.requestSha256 !== control.requestSha256 ||
        response.outcome !== outcome ||
        round.outcome !== outcome ||
        round.responseSha256 !== sha256(canonicalJson(response))
      )
        this.denied('DISCUSSION_IDENTITY_MISMATCH');
      // Existing Discussion output includes one terminal newline; bind its exact Browser artifact.
      const outboundSha256 = sha256(canonicalJson(control) + '\n');
      const operationId = sha256(
        JSON.stringify({
          taskId: spec.taskId,
          kind: 'DISCUSSION',
          iteration: 1,
          round: round.round,
          outboundSha256,
        }),
      );
      const browserResponse = await readFile(
        path.join(this.root, 'runs', spec.taskId, 'codex-browser', operationId, 'response.txt'),
        'utf8',
      );
      if (
        canonicalJson(DiscussionResponseV1Schema.parse(JSON.parse(browserResponse))) !==
        canonicalJson(response)
      )
        this.denied('DISCUSSION_IDENTITY_MISMATCH');
      previous = round.responseSha256;
    }
  }

  async assertControlConfirmed(
    taskId: string,
    controlSha256: string,
    policy: TaskInteractionPolicyV1,
    identity: { kind: 'PLANNER' | 'REVIEWER'; iteration: number },
  ) {
    await this.assertPolicy(policy);
    const record = await new CodexBrowserControlStore(this.root).read(taskId);
    if (
      !record ||
      !['CONFIRMED', 'RESPONDED'].includes(record.operation.state) ||
      !record.conversationUrl ||
      record.operation.outboundSha256 !== controlSha256 ||
      record.operation.kind !== identity.kind ||
      record.operation.iteration !== identity.iteration ||
      record.operation.operationId !==
        sha256(JSON.stringify({ taskId, ...identity, outboundSha256: controlSha256 }))
    )
      this.denied('CODEX_BROWSER_SEND_NOT_CONFIRMED');
    new ConversationUrlPolicy(['https://chatgpt.com']).canonicalizeStable(record.conversationUrl);
  }

  async assertResponseReceived(request: ResponseIngressRequest, policy: TaskInteractionPolicyV1) {
    await this.assertPolicy(policy);
    // Capability-authenticated MCP wiring is not exposed by this adapter yet.
    if (request.source !== 'BROWSER') this.denied('LOCAL_MCP_INGRESS_NOT_CONFIGURED');
    const envelope = parseEnvelope(request.response);
    await this.assertControlConfirmed(request.taskId, request.controlSha256, policy, {
      kind: envelope.testStatus === undefined ? 'PLANNER' : 'REVIEWER',
      iteration: request.iteration,
    });
    const record = await new CodexBrowserControlStore(this.root).read(request.taskId);
    if (
      !record ||
      record.operation.state !== 'RESPONDED' ||
      record.operation.outboundSha256 !== request.controlSha256 ||
      record.operation.iteration !== request.iteration ||
      record.operation.inboundSha256 !== sha256(request.response)
    )
      this.denied('CODEX_BROWSER_RESPONSE_MISMATCH');
    const artifact = await readFile(
      path.join(
        this.root,
        'runs',
        request.taskId,
        'codex-browser',
        record.operation.operationId,
        'response.txt',
      ),
      'utf8',
    );
    if (artifact !== request.response) this.denied('CODEX_BROWSER_RESPONSE_MISMATCH');
  }
  private denied(code: string): never {
    throw new ChatbridgeError('LOCAL durable gate evidence is missing or inconsistent', code);
  }
}
