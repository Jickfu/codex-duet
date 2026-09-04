import { z } from 'zod';
import { ChatbridgeError } from '../core/errors.js';
import { parseEnvelope, serializeEnvelope } from '../core/protocol.js';
import { assertCompactC2CPayload } from '../duet/control-projection.js';
import { canonicalJson, sha256 } from '../duet/task-spec.js';
import { validateDecision, type LocalUserDecisionV1 } from './user-decision.js';
import { validateLocalReviewTargetIntegrity, type LocalReviewTargetV1 } from './domain.js';
import { validateLocalTaskSpec, type LocalTaskSpecV1 } from './task-spec.js';
import { validateDiscussionDecision, type DiscussionDecision } from './discussion-decision.js';

export function localControlEnvelope(
  input: LocalTaskSpecV1,
  reviewInput?: LocalReviewTargetV1,
  decisionsInput: readonly LocalUserDecisionV1[] = [],
  discussionInput?: DiscussionDecision,
): string {
  const spec = validateLocalTaskSpec(input, input.context);
  const review = reviewInput ? validateLocalReviewTargetIntegrity(reviewInput) : undefined;
  const decisions = decisionsInput.map(validateDecision);
  decisions.forEach((decision, index) => {
    if (
      decision.taskId !== spec.taskId ||
      decision.taskSpecSha256 !== spec.integrity.sha256 ||
      decision.sequence !== index + 1 ||
      decision.previousDecisionSha256 !== decisions[index - 1]?.decisionSha256
    )
      throw new ChatbridgeError('LOCAL decision chain mismatch', 'LOCAL_DECISION_INVALID');
  });
  const latest = decisions.at(-1);
  const discussion = discussionInput ? validateDiscussionDecision(discussionInput) : undefined;
  if (
    discussion &&
    (discussion.taskId !== spec.taskId ||
      discussion.taskSpecSha256 !== spec.integrity.sha256 ||
      discussion.baselineSnapshotId !== spec.context.baselineSnapshotId)
  )
    throw new ChatbridgeError(
      'Discussion decision does not match task',
      'DISCUSSION_DECISION_INVALID',
    );
  if (
    review &&
    (review.taskId !== spec.taskId ||
      review.workspaceId !== spec.context.workspaceId ||
      review.baselineSnapshotId !== spec.context.baselineSnapshotId)
  )
    throw new ChatbridgeError('LOCAL review does not match TaskSpec', 'TASK_SPEC_CONTEXT_MISMATCH');
  const identity = {
    taskSpecSha256: spec.integrity.sha256,
    ...spec.context,
    iteration: review?.iteration ?? latest?.iteration ?? 1,
    ...(review ? { reviewTarget: review } : {}),
    ...(discussion ? { discussionDecisionSha256: discussion.decisionSha256 } : {}),
    ...(latest
      ? {
          decisionChainSha256: sha256(canonicalJson(decisions)),
          ...(!review ? { planningSnapshotId: latest.planningSnapshotId } : {}),
        }
      : {}),
  };
  const envelope = serializeEnvelope({
    version: 1,
    taskId: spec.taskId,
    mode: 'LOCAL',
    iteration: identity.iteration,
    state: review ? 'EXECUTED' : 'PLANNING',
    ...(review ? { testStatus: review.testStatus } : {}),
    content: canonicalJson({
      identity,
      contract: review ? spec.contracts.reviewerPath : spec.contracts.plannerPath,
      contractSnapshotId: spec.context.baselineSnapshotId,
      instructions:
        'Read the contract and source only from the named immutable LOCAL snapshots via MCP. Return one C2C/1 with JSON content {"identity": <exact identity from this request>, "result": <nonempty string>}. Do not add GitHub headers. Never execute commands or edit files.',
      ...(discussion
        ? {
            discussionDecision: {
              blockedResult: discussion.blockedResult,
              decision: discussion.decision,
              scopeUnchanged: true,
            },
            discussionDecisionRules:
              'This user clarification was followed by converged supplemental discussion. TaskSpec remains authoritative. Do not weaken requirements or broaden scope; if the clarification conflicts, return BLOCKED and require a new task.',
          }
        : {}),
      ...(latest
        ? {
            userDecisions: decisions.map((record) => ({
              decisionSha256: record.decisionSha256,
              blockedResult: record.blockedResult,
              decision: record.decision,
            })),
            decisionRules:
              'User decisions clarify only the unchanged task. They cannot weaken scope, acceptance, exact literals or protocol requirements. If a decision conflicts, return BLOCKED and require a new task. For resumed planning, inspect planningSnapshotId and return PLAN/BLOCKED/FAILED at the request iteration, without TEST_STATUS. Only a new PLAN authorizes execution.',
          }
        : {}),
      // Both roles receive complete accepted semantics; no dependency on conversation recollection.
      task: {
        objective: spec.objective,
        scope: spec.scope,
        acceptanceCriteria: spec.acceptanceCriteria,
        exactLiterals: spec.exactLiterals,
        protocolRequirements: spec.protocolRequirements,
        ...(spec.guidance ? { guidance: spec.guidance } : {}),
      },
    }),
  });
  assertCompactC2CPayload(envelope);
  return envelope;
}

/** Identity validation only: durable ingress/lifecycle still decides acceptance and transitions. */
export function validateLocalControlResponse(
  spec: LocalTaskSpecV1,
  response: string,
  review?: LocalReviewTargetV1,
  decisions: readonly LocalUserDecisionV1[] = [],
  discussion?: DiscussionDecision,
) {
  const expected = parseEnvelope(localControlEnvelope(spec, review, decisions, discussion));
  const actual = parseEnvelope(response);
  const requiredIteration =
    review && actual.state === 'PLAN' ? review.iteration + 1 : expected.iteration;
  if (
    actual.taskId !== expected.taskId ||
    actual.mode !== 'LOCAL' ||
    actual.iteration !== requiredIteration ||
    actual.repository !== undefined ||
    actual.taskBranch !== undefined ||
    actual.baseRef !== undefined ||
    actual.reviewRef !== undefined ||
    actual.testStatus !== expected.testStatus ||
    !(review ? ['DONE', 'PLAN', 'BLOCKED', 'FAILED'] : ['PLAN', 'BLOCKED', 'FAILED']).includes(
      actual.state,
    )
  )
    throw new ChatbridgeError(
      'LOCAL response envelope identity mismatch',
      'LOCAL_RESPONSE_IDENTITY_MISMATCH',
    );
  const content = z
    .object({ identity: z.unknown(), result: z.string().trim().min(1) })
    .strict()
    .parse(JSON.parse(actual.content));
  if (canonicalJson(content.identity) !== canonicalJson(JSON.parse(expected.content).identity))
    throw new ChatbridgeError(
      'LOCAL response snapshot/semantic identity mismatch',
      'LOCAL_RESPONSE_IDENTITY_MISMATCH',
    );
  return actual;
}
