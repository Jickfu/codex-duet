import { canonicalJson, sha256 } from '../../src/duet/task-spec.js';
import type { LocalContextRef } from '../../src/local/domain.js';
import type { LocalTaskSpecV1 } from '../../src/local/task-spec.js';

export const localRequest = 'Keep exact-name unchanged.';
export function localSpec(
  context: LocalContextRef = {
    mode: 'LOCAL',
    taskId: 'demo',
    workspaceId: 'a'.repeat(64),
    baselineSnapshotId: 'b'.repeat(64),
  },
): LocalTaskSpecV1 {
  const content = {
    version: 1 as const,
    mode: 'LOCAL' as const,
    taskId: context.taskId,
    context,
    objective: 'Preserve behavior',
    scope: { allowed: ['src'], forbidden: ['M5'] },
    acceptanceCriteria: [{ id: 'a', requirement: 'Preserve bytes', priority: 'MUST' as const }],
    exactLiterals: [{ id: 'x', value: 'exact-name', usage: 'Output', caseSensitive: true }],
    protocolRequirements: [],
    source: { rawRequestSha256: sha256(localRequest) },
    contracts: {
      plannerPath: 'docs/contracts/local-planner-v1.md' as const,
      reviewerPath: 'docs/contracts/local-reviewer-v1.md' as const,
      resolution: 'AT_BASELINE_SNAPSHOT' as const,
    },
  };
  return { ...content, integrity: { sha256: sha256(canonicalJson(content)) } };
}
export function rehashLocalSpec(spec: LocalTaskSpecV1): LocalTaskSpecV1 {
  const content = Object.fromEntries(Object.entries(spec).filter(([key]) => key !== 'integrity'));
  return { ...spec, integrity: { sha256: sha256(canonicalJson(content)) } };
}
