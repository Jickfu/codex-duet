import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition } from '../../src/core/state-machine.js';
describe('state machine', () => {
  it('accepts workflow transitions', () => expect(canTransition('REVIEWING', 'PLAN')).toBe(true));
  it('rejects terminal transitions', () =>
    expect(() => assertTransition('DONE', 'EXECUTING')).toThrow(/Illegal/));
});
