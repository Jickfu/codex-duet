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
  it('rejects mismatched sections', () =>
    expect(() => parseEnvelope('[C2C/1]\nTASK: x\nITERATION: 1\nSTATE: PLAN\n\nDONE:\nno')).toThrow(
      /does not match/,
    ));
});
