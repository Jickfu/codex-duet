import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { parseEnvelope, serializeEnvelope } from '../../src/core/protocol.js';
import { sha256 } from '../../src/duet/task-spec.js';
import { LocalLifecycle, type LocalRunV1 } from '../../src/local/lifecycle.js';
import { localReviewTargetFingerprint, type LocalReviewTargetV1 } from '../../src/local/domain.js';
import { localSpec } from '../fixtures/local-task-spec.js';

async function fixture(maxIterations = 3) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-run-'));
  const spec = localSpec();
  let live = spec.context.baselineSnapshotId;
  const reviews: LocalReviewTargetV1[] = [];
  const snapshots = {
    capture: vi.fn(),
    async assertLiveSnapshot(expected: string) {
      if (expected !== live) throw new Error('drift');
    },
  };
  const provider = {
    async status() {
      return { context: spec.context, reviews };
    },
    async prepareReview({ iteration }: { iteration: number }) {
      if (reviews[iteration - 1]) return reviews[iteration - 1]!;
      const content = {
        version: 1 as const,
        mode: 'LOCAL' as const,
        taskId: spec.taskId,
        iteration,
        workspaceId: spec.context.workspaceId,
        baselineSnapshotId: spec.context.baselineSnapshotId,
        reviewSnapshotId: live,
        ...(reviews.length ? { previousReviewSnapshotId: reviews.at(-1)!.reviewSnapshotId } : {}),
        testStatus: 'PASS' as const,
        testEvidenceSha256: 'd'.repeat(64),
        executionSummarySha256: 'e'.repeat(64),
        changeAttribution: 'UNATTRIBUTED_NET_DELTA' as const,
      };
      const target = { ...content, reviewTargetSha256: localReviewTargetFingerprint(content) };
      reviews.push(target);
      return target;
    },
  };
  const gates = {
    assertPlanningReady: vi.fn(async () => {}),
    assertControlConfirmed: vi.fn(async () => {}),
  };
  const create = () => new LocalLifecycle(root, provider as never, snapshots, gates);
  const service = create();
  const policy = {
    version: 1 as const,
    taskId: 'demo',
    browserControlProvider: 'CODEX_BROWSER' as const,
    discussion: { enabled: true },
    selectedAt: new Date(0).toISOString(),
  };
  const init = () => service.init(spec, policy, maxIterations);
  return {
    root,
    spec,
    service,
    create,
    gates,
    init,
    setLive: (value: string) => {
      live = value;
    },
    file: path.join(root, 'runs', 'demo', 'local', 'run.json'),
  };
}
function response(run: LocalRunV1, state: 'PLAN' | 'DONE' | 'BLOCKED' = 'PLAN') {
  const control = parseEnvelope(run.control);
  return {
    taskId: run.taskId,
    iteration: control.iteration,
    controlSha256: sha256(run.control),
    source: 'BROWSER' as const,
    response: serializeEnvelope({
      ...control,
      state,
      iteration:
        state === 'PLAN' && control.state === 'EXECUTED'
          ? control.iteration + 1
          : control.iteration,
      content: JSON.stringify({
        identity: JSON.parse(control.content).identity,
        result: 'fixture result',
      }),
    }),
  };
}
describe('LOCAL durable lifecycle', () => {
  it('runs two rounds through shared ingress, survives restart, and preserves exact replay', async () => {
    const f = await fixture();
    const initial = await f.init();
    expect(await f.init()).toEqual(initial);
    await expect(f.service.ingest(response(initial))).rejects.toThrow();
    await f.service.confirmControl('demo');
    const plan = response(initial);
    await f.service.ingest(plan);
    expect((await f.create().ingest(plan)).disposition).toBe('REPLAY');
    expect((await f.create().ingest({ ...plan, source: 'MCP' })).disposition).toBe('REPLAY');
    for (const iteration of [1, 2]) {
      await f.create().beginExecution('demo');
      f.setLive(String(iteration).repeat(64));
      const prepared = await f.create().prepareReview('demo');
      expect(prepared.state).toBe('EXECUTED');
      await expect(f.service.ingest(response(prepared, 'DONE'))).rejects.toThrow();
      await f.create().confirmControl('demo');
      await f.create().ingest(response(prepared, iteration === 1 ? 'PLAN' : 'DONE'));
    }
    expect((await f.create().status('demo')).state).toBe('DONE');
    await expect(f.create().beginExecution('demo')).rejects.toThrow();
    await expect(f.create().ingest({ ...plan, iteration: 2 })).rejects.toThrow();
  });

  it('fails closed on Discussion, transport confirmation and live drift', async () => {
    const f = await fixture();
    f.gates.assertPlanningReady.mockRejectedValueOnce(new Error('Discussion pending'));
    await expect(f.init()).rejects.toThrow('Discussion pending');
    await expect(readFile(f.file)).rejects.toMatchObject({ code: 'ENOENT' });
    const initial = await f.init();
    f.gates.assertControlConfirmed.mockRejectedValueOnce(new Error('SEND_OUTCOME_UNKNOWN'));
    await expect(f.service.confirmControl('demo')).rejects.toThrow('SEND_OUTCOME_UNKNOWN');
    expect((await f.service.status('demo')).confirmed).toBe(false);
    await f.service.confirmControl('demo');
    f.setLive('f'.repeat(64));
    await expect(f.service.ingest(response(initial))).rejects.toThrow('drift');
    f.setLive(f.spec.context.baselineSnapshotId);
    await f.service.ingest(response(initial));
    f.setLive('f'.repeat(64));
    await expect(f.service.beginExecution('demo')).rejects.toThrow('drift');
    expect((await f.service.status('demo')).state).toBe('PLAN');
  });

  it('recovers provider publication before checkpoint and checkpoint before ingress acceptance', async () => {
    const f = await fixture();
    const initial = await f.init();
    await f.service.confirmControl('demo');
    const request = response(initial);
    await f.service.ingest(request);
    const ingressFile = path.join(
      f.root,
      'runs',
      'demo',
      'ingress',
      '1',
      request.controlSha256 + '.json',
    );
    const record = JSON.parse(await readFile(ingressFile, 'utf8'));
    record.status = 'PENDING';
    delete record.acceptedAt;
    await writeFile(ingressFile, JSON.stringify(record));
    expect((await f.create().ingest(request)).disposition).toBe('ACCEPTED');
    expect((await f.service.status('demo')).responses).toHaveLength(1);
    await f.service.beginExecution('demo');
    const executing = await readFile(f.file);
    f.setLive('c'.repeat(64));
    const prepared = await f.service.prepareReview('demo');
    await writeFile(f.file, executing);
    expect(await f.create().prepareReview('demo')).toEqual(prepared);
  });

  it('enforces iteration limit and rejects divergent or corrupt durable authority', async () => {
    const f = await fixture(1);
    const initial = await f.init();
    await f.service.confirmControl('demo');
    const request = response(initial);
    await f.service.ingest(request);
    await expect(
      f.service.ingest({ ...request, response: request.response + ' ' }),
    ).rejects.toThrow();
    await f.service.beginExecution('demo');
    const target = await f.service.prepareReview('demo');
    await f.service.confirmControl('demo');
    await expect(f.service.ingest(response(target))).rejects.toMatchObject({
      code: 'LOCAL_ITERATION_LIMIT',
    });
    await f.service.ingest(response(target, 'DONE'));
    const run = await f.service.status('demo');
    run.plan = 'tampered';
    await writeFile(f.file, JSON.stringify(run));
    await expect(f.create().status('demo')).rejects.toThrow();
  });
});
