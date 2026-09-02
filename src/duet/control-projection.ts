import { serializeEnvelope } from '../core/protocol.js';
import { ChatbridgeError } from '../core/errors.js';
import type { GitHubContextRef, GitHubReviewTarget } from '../providers/code-provider.js';
import type { TaskSpecV1 } from './task-spec.js';

export const COMPACT_C2C_LIMIT_BYTES = 8192;

export function assertCompactC2CPayload(serializedEnvelope: string): number {
  const actualBytes = Buffer.byteLength(serializedEnvelope, 'utf8');
  if (actualBytes > COMPACT_C2C_LIMIT_BYTES)
    throw new ChatbridgeError(
      `Compact C2C payload exceeds the product limit; limitBytes=${COMPACT_C2C_LIMIT_BYTES} actualBytes=${actualBytes}`,
      'C2C_PAYLOAD_TOO_LARGE',
    );
  return actualBytes;
}

export function plannerControlEnvelope(
  context: GitHubContextRef,
  taskSpec: TaskSpecV1,
  iteration = 1,
): string {
  const sections: string[] = [
    `Apply ${taskSpec.contracts.plannerPath} at BASE_REF.`,
    section('Objective', [taskSpec.objective]),
    section('Allowed', taskSpec.scope.allowed),
    section('Forbidden', taskSpec.scope.forbidden),
    section(
      'Must accept',
      taskSpec.acceptanceCriteria
        .filter((criterion) => criterion.priority === 'MUST')
        .map((criterion) => `${criterion.id}: ${criterion.requirement}`),
    ),
    section(
      'Should accept',
      taskSpec.acceptanceCriteria
        .filter((criterion) => criterion.priority === 'SHOULD')
        .map((criterion) => `${criterion.id}: ${criterion.requirement}`),
    ),
    section(
      'Exact literals',
      taskSpec.exactLiterals.map(
        (literal) =>
          `${literal.id}: ${JSON.stringify(literal.value)}; usage=${literal.usage}; caseSensitive=${literal.caseSensitive}`,
      ),
    ),
    section(
      'Special protocol',
      taskSpec.protocolRequirements.map(
        (requirement) =>
          `${requirement.id}: ${requirement.requirement}; replaySafety=${requirement.replaySafety}`,
      ),
    ),
    section('Planner notes', taskSpec.guidance?.plannerNotes ?? []),
    section('Review criteria', taskSpec.guidance?.reviewCriteria ?? []),
    'Use repository context from the GitHub Data Plane.\nReturn only C2C/1.',
  ].filter(Boolean);
  const envelope = serializeEnvelope({
    version: 1,
    taskId: context.taskId,
    iteration,
    state: 'PLANNING',
    mode: 'GITHUB',
    repository: context.repository,
    taskBranch: context.taskBranch,
    baseRef: context.baseRef,
    content: sections.join('\n\n'),
  });
  assertCompactC2CPayload(envelope);
  return envelope;
}

export function reviewerControlEnvelope(
  target: GitHubReviewTarget,
  contractPath: string,
  iteration: number,
  previousReviewRef?: string,
): string {
  const formalRange = `${target.baseRef}..${target.reviewRef}`;
  const content = [
    `Apply ${contractPath} at BASE_REF.`,
    `Review immutable ${formalRange} against the accepted task specification from the first Planner turn in this bound conversation.`,
    ...(previousReviewRef
      ? [
          `First inspect iteration delta ${previousReviewRef}..${target.reviewRef}; formal approval remains ${formalRange}.`,
        ]
      : []),
  ].join('\n');
  const envelope = serializeEnvelope({
    version: 1,
    taskId: target.taskId,
    iteration,
    state: 'EXECUTED',
    mode: 'GITHUB',
    repository: target.repository,
    taskBranch: target.taskBranch,
    baseRef: target.baseRef,
    reviewRef: target.reviewRef,
    testStatus: target.testStatus,
    content,
  });
  assertCompactC2CPayload(envelope);
  return envelope;
}

function section(title: string, values: string[]): string {
  return values.length === 0 ? '' : `${title}:\n${values.map((value) => `- ${value}`).join('\n')}`;
}
