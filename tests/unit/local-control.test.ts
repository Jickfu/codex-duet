import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { parseEnvelope, serializeEnvelope } from '../../src/core/protocol.js';
import { LocalTaskSpecStore, validateLocalTaskSpec } from '../../src/local/task-spec.js';
import {
  localControlEnvelope,
  validateLocalControlResponse,
} from '../../src/local/control-projection.js';
import { localReviewTargetFingerprint } from '../../src/local/domain.js';
import { localSpec, localRequest, rehashLocalSpec } from '../fixtures/local-task-spec.js';

function review() {
  const content = {
    version: 1 as const,
    mode: 'LOCAL' as const,
    taskId: 'demo',
    iteration: 1,
    workspaceId: 'a'.repeat(64),
    baselineSnapshotId: 'b'.repeat(64),
    reviewSnapshotId: 'c'.repeat(64),
    testEvidenceSha256: 'd'.repeat(64),
    executionSummarySha256: 'e'.repeat(64),
    testStatus: 'PASS' as const,
    changeAttribution: 'UNATTRIBUTED_NET_DELTA' as const,
  };
  return { ...content, reviewTargetSha256: localReviewTargetFingerprint(content) };
}
describe('LOCAL TaskSpec and control identity', () => {
  it('validates request bytes, exact literals, context and semantic integrity', () => {
    const spec = localSpec();
    expect(validateLocalTaskSpec(spec, spec.context, localRequest)).toEqual(spec);
    expect(() => validateLocalTaskSpec(spec, spec.context, localRequest + '\n')).toThrow();
    expect(() => validateLocalTaskSpec({ ...spec, objective: 'tampered' }, spec.context)).toThrow();
    expect(() => validateLocalTaskSpec(spec, { ...spec.context, taskId: 'other' })).toThrow();
    expect(() =>
      validateLocalTaskSpec(
        { ...spec, context: { ...spec.context, baseRef: 'a'.repeat(40) } },
        spec.context,
      ),
    ).toThrow();
    spec.exactLiterals[0]!.value = 'absent';
    expect(() =>
      validateLocalTaskSpec(rehashLocalSpec(spec), spec.context, localRequest),
    ).toThrow();
  });
  it('persists only immutable matching semantic content and rejects foreign context on read', async () => {
    const store = new LocalTaskSpecStore(await mkdtemp(path.join(os.tmpdir(), 'local-spec-')));
    const spec = localSpec();
    await store.createOrVerify(spec, spec.context);
    await store.createOrVerify(spec, spec.context);
    expect(await store.read(spec.context)).toEqual(spec);
    await expect(store.read({ ...spec.context, workspaceId: 'f'.repeat(64) })).rejects.toThrow();
    await expect(
      store.createOrVerify(rehashLocalSpec({ ...spec, objective: 'different' }), spec.context),
    ).rejects.toThrow();
  });
  it('projects both roles without GitHub headers and fails closed on full-envelope overflow', () => {
    const spec = localSpec();
    for (const target of [undefined, review()]) {
      const control = localControlEnvelope(spec, target);
      expect(Buffer.byteLength(control)).toBeLessThanOrEqual(8192);
      const envelope = parseEnvelope(control);
      expect(envelope.mode).toBe('LOCAL');
      expect(envelope.baseRef).toBeUndefined();
      expect(JSON.parse(envelope.content).identity.taskSpecSha256).toBe(spec.integrity.sha256);
    }
    expect(() =>
      localControlEnvelope(rehashLocalSpec({ ...spec, objective: '界'.repeat(4000) })),
    ).toThrow();
    const foreign = review();
    foreign.workspaceId = 'f'.repeat(64);
    expect(() => localControlEnvelope(spec, foreign)).toThrow();
    const foreignContent = { ...foreign };
    const { reviewTargetSha256, ...withoutFingerprint } = foreignContent;
    expect(reviewTargetSha256).toBeTruthy();
    foreign.reviewTargetSha256 = localReviewTargetFingerprint(withoutFingerprint);
    expect(() => localControlEnvelope(spec, foreign)).toThrow();
  });
  it.each(['DONE', 'PLAN', 'BLOCKED', 'FAILED'] as const)(
    'validates reviewed identity on %s, including N+1 correction semantics',
    (state) => {
      const spec = localSpec();
      const target = review();
      const request = parseEnvelope(localControlEnvelope(spec, target));
      const identity = JSON.parse(request.content).identity;
      const response = {
        ...request,
        state,
        iteration: state === 'PLAN' ? 2 : 1,
        content: JSON.stringify({ identity, result: 'Reviewed' }),
      };
      expect(validateLocalControlResponse(spec, serializeEnvelope(response), target).state).toBe(
        state,
      );
      const bad = { ...identity, taskSpecSha256: 'f'.repeat(64) };
      expect(() =>
        validateLocalControlResponse(
          spec,
          serializeEnvelope({
            ...response,
            content: JSON.stringify({ identity: bad, result: 'Reviewed' }),
          }),
          target,
        ),
      ).toThrow();
      expect(() =>
        validateLocalControlResponse(
          spec,
          serializeEnvelope({ ...response, reviewRef: 'a'.repeat(40) }),
          target,
        ),
      ).toThrow();
      expect(() =>
        validateLocalControlResponse(
          spec,
          serializeEnvelope({ ...response, iteration: 3 }),
          target,
        ),
      ).toThrow();
    },
  );
  it('does not accept DONE at initial planning or omitted identity', () => {
    const spec = localSpec();
    const request = parseEnvelope(localControlEnvelope(spec));
    const content = JSON.stringify({
      identity: JSON.parse(request.content).identity,
      result: 'Plan',
    });
    expect(
      validateLocalControlResponse(spec, serializeEnvelope({ ...request, state: 'PLAN', content }))
        .state,
    ).toBe('PLAN');
    expect(() =>
      validateLocalControlResponse(spec, serializeEnvelope({ ...request, state: 'DONE', content })),
    ).toThrow();
    expect(() =>
      validateLocalControlResponse(
        spec,
        serializeEnvelope({ ...request, state: 'PLAN', content: '{"result":"Plan"}' }),
      ),
    ).toThrow();
  });
});
