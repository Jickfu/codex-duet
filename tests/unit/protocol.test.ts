import { describe, expect, it } from 'vitest';
import { parseEnvelope, serializeEnvelope } from '../../src/core/protocol.js';
describe('C2C/1 protocol', () => {
  it('round trips an envelope', () => {
    const value = {
      version: 1 as const,
      taskId: '01JTEST',
      iteration: 2,
      state: 'PLAN' as const,
      content: 'Change the parser.',
    };
    expect(parseEnvelope(serializeEnvelope(value))).toEqual(value);
  });
  it('rejects malformed messages', () =>
    expect(() => parseEnvelope('PLAN: maybe')).toThrow(/Malformed/));
  it('rejects unknown or duplicate headers', () => {
    expect(() =>
      parseEnvelope('[C2C/1]\nTASK: x\nITERATION: 1\nSTATE: PLAN\nUNKNOWN: x\n\nPLAN:\nx'),
    ).toThrow(/Malformed/);
    expect(() =>
      parseEnvelope('[C2C/1]\nTASK: x\nTASK: y\nITERATION: 1\nSTATE: PLAN\n\nPLAN:\nx'),
    ).toThrow(/Malformed/);
  });
  it('rejects mismatched sections', () =>
    expect(() => parseEnvelope('[C2C/1]\nTASK: x\nITERATION: 1\nSTATE: PLAN\n\nDONE:\nno')).toThrow(
      /does not match/,
    ));

  it('round trips a strict GitHub review target', () => {
    const value = {
      version: 1 as const,
      taskId: 'review_1',
      iteration: 1,
      state: 'EXECUTED' as const,
      mode: 'GITHUB' as const,
      repository: 'owner/repo',
      taskBranch: 'agent/task-review_1',
      baseRef: 'a'.repeat(40),
      reviewRef: 'b'.repeat(40),
      testStatus: 'PASS' as const,
      content: 'Review exactly BASE_REF..REVIEW_REF.',
    };
    expect(parseEnvelope(serializeEnvelope(value))).toEqual(value);
  });

  it('requires immutable GitHub fields only for EXECUTED', () => {
    const plan = {
      version: 1 as const,
      taskId: 'x',
      iteration: 0,
      state: 'PLAN' as const,
      mode: 'GITHUB' as const,
      content: 'Plan.',
    };
    expect(() => serializeEnvelope(plan)).not.toThrow();
    expect(() => serializeEnvelope({ ...plan, state: 'EXECUTED' as const })).toThrow(/required/);
  });

  it('rejects moving refs and short SHAs', () => {
    expect(() =>
      serializeEnvelope({
        version: 1,
        taskId: 'x',
        iteration: 1,
        state: 'EXECUTED',
        mode: 'GITHUB',
        repository: 'owner/repo',
        taskBranch: 'agent/task-x',
        baseRef: 'main',
        reviewRef: 'abcdef1',
        testStatus: 'PASS',
        content: 'review',
      }),
    ).toThrow(/40-character SHA/);
  });
});
