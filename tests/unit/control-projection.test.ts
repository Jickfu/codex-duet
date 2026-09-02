import { describe, expect, it } from 'vitest';
import { serializeEnvelope } from '../../src/core/protocol.js';
import {
  assertCompactC2CPayload,
  COMPACT_C2C_LIMIT_BYTES,
  plannerControlEnvelope,
  reviewerControlEnvelope,
} from '../../src/duet/control-projection.js';
import { taskSpecFingerprint, type TaskSpecWithoutIntegrity } from '../../src/duet/task-spec.js';
import type { GitHubContextRef, GitHubReviewTarget } from '../../src/providers/code-provider.js';

const context: GitHubContextRef = {
  mode: 'GITHUB',
  repository: 'owner/repo',
  remote: 'origin',
  taskId: 'demo',
  taskBranch: 'agent/task-demo',
  baseRef: 'a'.repeat(40),
};
const target: GitHubReviewTarget = {
  ...context,
  reviewRef: 'b'.repeat(40),
  testStatus: 'PASS',
};

function taskSpec() {
  const content: TaskSpecWithoutIntegrity = {
    version: 1,
    taskId: 'demo',
    mode: 'GITHUB',
    objective: 'Implement compact control.',
    scope: { allowed: ['src/duet'], forbidden: ['C2C/2'] },
    acceptanceCriteria: [
      { id: 'must', requirement: 'Keep C2C/1', priority: 'MUST' },
      { id: 'should', requirement: 'Optional polish', priority: 'SHOULD' },
    ],
    exactLiterals: [
      {
        id: 'literal',
        value: 'C2C_PAYLOAD_TOO_LARGE',
        usage: 'SYSTEM_GENERATED: error code',
        caseSensitive: true,
      },
    ],
    protocolRequirements: [
      { id: 'send', requirement: 'Never replay ambiguous send', replaySafety: 'NON_IDEMPOTENT' },
    ],
    context: {
      repository: context.repository,
      taskBranch: context.taskBranch,
      baseRef: context.baseRef,
    },
    source: { rawRequestSha256: 'c'.repeat(64) },
    contracts: {
      plannerPath: 'docs/contracts/planner-v1.md',
      reviewerPath: 'docs/contracts/reviewer-v1.md',
      resolution: 'AT_BASE_REF',
    },
  };
  return { ...content, integrity: { sha256: taskSpecFingerprint(content) } };
}

function sizedEnvelope(bytes: number): string {
  const empty = serializeEnvelope({
    version: 1,
    taskId: 'demo',
    iteration: 1,
    state: 'PLANNING',
    content: '',
  });
  return serializeEnvelope({
    version: 1,
    taskId: 'demo',
    iteration: 1,
    state: 'PLANNING',
    content: 'x'.repeat(bytes - Buffer.byteLength(empty, 'utf8')),
  });
}

describe('compact control projections', () => {
  it('emits deterministic Planner semantics without stable boilerplate or SHOULD criteria', () => {
    const first = plannerControlEnvelope(context, taskSpec());
    expect(plannerControlEnvelope(context, taskSpec())).toBe(first);
    expect(first).toContain('docs/contracts/planner-v1.md');
    expect(first).toContain('Implement compact control.');
    expect(first).toContain('Keep C2C/1');
    expect(first).toContain('C2C_PAYLOAD_TOO_LARGE');
    expect(first).toContain('replaySafety=NON_IDEMPOTENT');
    expect(first).not.toContain('Optional polish');
    expect(first).not.toContain('Planner notes:');
    expect(first).not.toContain('Act as Planner and Architect');
    expect(first).toContain(`BASE_REF: ${context.baseRef}`);
  });

  it('emits a compact immutable Reviewer control with optional delta focus', () => {
    const first = reviewerControlEnvelope(
      target,
      'docs/contracts/reviewer-v1.md',
      2,
      'c'.repeat(40),
    );
    expect(first).toContain('ITERATION: 2');
    expect(first).toContain(`BASE_REF: ${target.baseRef}`);
    expect(first).toContain(`REVIEW_REF: ${target.reviewRef}`);
    expect(first).toContain('TEST_STATUS: PASS');
    expect(first).toContain('docs/contracts/reviewer-v1.md');
    expect(first).toContain(`${'c'.repeat(40)}..${target.reviewRef}`);
    expect(first).toContain(`${target.baseRef}..${target.reviewRef}`);
    expect(first).not.toContain('Implement compact control.');
  });

  it('accepts 8192 final UTF-8 bytes and rejects 8193 deterministically', () => {
    const atLimit = sizedEnvelope(COMPACT_C2C_LIMIT_BYTES);
    const overLimit = sizedEnvelope(COMPACT_C2C_LIMIT_BYTES + 1);
    expect(Buffer.byteLength(atLimit, 'utf8')).toBe(8192);
    expect(Buffer.byteLength(overLimit, 'utf8')).toBe(8193);
    expect(assertCompactC2CPayload(atLimit)).toBe(8192);
    try {
      assertCompactC2CPayload(overLimit);
      throw new Error('Expected oversized payload rejection');
    } catch (error) {
      expect(error).toMatchObject({ code: 'C2C_PAYLOAD_TOO_LARGE' });
      expect((error as Error).message).toContain('limitBytes=8192 actualBytes=8193');
    }
  });

  it('measures multibyte Unicode as UTF-8 bytes', () => {
    expect(assertCompactC2CPayload('汉')).toBe(3);
    expect(() => assertCompactC2CPayload('汉'.repeat(2730))).not.toThrow();
    expect(() => assertCompactC2CPayload('汉'.repeat(2731))).toThrow();
  });
});
