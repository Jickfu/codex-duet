import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalFormatRepair, repairMeaning } from '../../src/local/format-repair.js';
import { localControlEnvelope } from '../../src/local/control-projection.js';
import { localSpec } from '../fixtures/local-task-spec.js';
import { parseEnvelope, serializeEnvelope } from '../../src/core/protocol.js';
import { canonicalJson, sha256 } from '../../src/duet/task-spec.js';
import { CodexBrowserControlStore } from '../../src/duet/codex-browser-control-store.js';
import { TaskInteractionPolicyStore } from '../../src/duet/interaction-policy-store.js';
import { StoredLocalLifecycleGates } from '../../src/local/lifecycle-gates.js';
import { LocalLifecycle, type LocalRunV1 } from '../../src/local/lifecycle.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'format-repair-'));
  const spec = localSpec();
  const control = localControlEnvelope(spec);
  const envelope = parseEnvelope(control);
  const identity = JSON.parse(envelope.content).identity;
  const result = 'Return "Hello, Duet!" unchanged.';
  const bad = serializeEnvelope({
    ...envelope,
    state: 'PLAN',
    content: `{"identity":${JSON.stringify(identity)},"result":"${result}"}`,
  });
  const good = serializeEnvelope({
    ...envelope,
    state: 'PLAN',
    content: JSON.stringify({ identity, result }),
  });
  const policy = {
    version: 1 as const,
    taskId: 'demo',
    browserControlProvider: 'CODEX_BROWSER' as const,
    discussion: { enabled: false },
    selectedAt: new Date(0).toISOString(),
  };
  await new TaskInteractionPolicyStore(root).createOrVerify(policy);
  const run: LocalRunV1 = {
    version: 1,
    mode: 'LOCAL',
    taskId: 'demo',
    spec,
    policy,
    state: 'PLANNING',
    iteration: 1,
    maxIterations: 5,
    control,
    confirmed: true,
    responses: [],
    reviews: [],
  };
  const store = new CodexBrowserControlStore(root);
  const receive = async (
    outbound: string,
    response: string,
    state: 'RESPONDED' | 'ATTEMPTED' = 'RESPONDED',
  ) => {
    const outboundSha256 = sha256(outbound);
    const operationId = sha256(
      JSON.stringify({ taskId: 'demo', kind: 'PLANNER', iteration: 1, outboundSha256 }),
    );
    await store.createResponseArtifact('demo', operationId, response);
    await store.write({
      version: 1,
      taskId: 'demo',
      provider: 'CODEX_BROWSER',
      conversationUrl: 'https://chatgpt.com/c/repair-fixture',
      operation: {
        operationId,
        kind: 'PLANNER',
        iteration: 1,
        outboundSha256,
        state,
        preparedAt: new Date(0).toISOString(),
        ...(state === 'RESPONDED'
          ? { completedAt: new Date(0).toISOString(), inboundSha256: sha256(response) }
          : {}),
      },
    });
  };
  await receive(control, bad);
  const repair = new LocalFormatRepair(root);
  return {
    root,
    run,
    control,
    bad,
    good,
    result,
    repair,
    receive,
    store,
    gates: new StoredLocalLifecycleGates(root),
  };
}

describe('bounded lossless LOCAL format repair', () => {
  it('repairs only the missing DONE section while preserving full identity and decoded result', async () => {
    const f = await fixture();
    const parsed = parseEnvelope(f.control);
    const control = serializeEnvelope({ ...parsed, state: 'EXECUTED', testStatus: 'PASS' });
    const body = canonicalJson({
      identity: JSON.parse(parsed.content).identity,
      result: 'Approved `exact` bytes.',
    });
    const good = serializeEnvelope({ ...parsed, state: 'DONE', testStatus: 'PASS', content: body });
    const bad = good.replace('\n\nDONE:\n', '\n\n');
    expect(repairMeaning(control, bad).result).toBe('Approved `exact` bytes.');
    for (const invalid of [
      good,
      bad.replace('STATE: DONE', 'STATE: PLAN'),
      bad.replace('TEST_STATUS: PASS', 'TEST_STATUS: FAIL'),
      bad.replace('TASK: demo', 'TASK: other'),
      bad.replace('"result":', '"extra":1,"result":'),
      bad.replace('"result":', '"result":"other","result":'),
      bad.replace('\n\n{', '\n\nDONE WRONG:\n{'),
    ])
      expect(() => repairMeaning(control, invalid)).toThrow();
    const receive = async (outbound: string, response: string) => {
      const outboundSha256 = sha256(outbound);
      const operationId = sha256(
        JSON.stringify({ taskId: 'demo', kind: 'REVIEWER', iteration: 1, outboundSha256 }),
      );
      await f.store.createResponseArtifact('demo', operationId, response);
      await f.store.write({
        version: 1,
        taskId: 'demo',
        provider: 'CODEX_BROWSER',
        conversationUrl: 'https://chatgpt.com/c/repair-fixture',
        operation: {
          operationId,
          kind: 'REVIEWER',
          iteration: 1,
          outboundSha256,
          state: 'RESPONDED',
          preparedAt: new Date(0).toISOString(),
          completedAt: new Date(0).toISOString(),
          inboundSha256: sha256(response),
        },
      });
    };
    await receive(control, bad);
    const request = await f.repair.prepare({ ...f.run, state: 'REVIEWING', control }, 1, bad);
    expect(request.control).toContain('Insert the missing DONE: line');
    await receive(request.control, good);
    expect(await f.repair.responseControl('demo', sha256(control), good)).toBe(request.control);
    await expect(
      f.repair.responseControl('demo', sha256(control), good.replace('Approved', 'Changed')),
    ).rejects.toThrow();
    await f.gates.assertResponseReceived(
      {
        taskId: 'demo',
        iteration: 1,
        controlSha256: sha256(control),
        response: good,
        source: 'BROWSER',
      },
      f.run.policy,
    );
  });
  it('requires original durable evidence and preserves exact raw artifacts across restart', async () => {
    const f = await fixture();
    const first = await f.repair.prepare(f.run, 1, f.bad);
    expect(await readFile(first.controlFile, 'utf8')).toBe(first.control);
    expect(await new LocalFormatRepair(f.root).prepare(f.run, 1, f.bad)).toEqual(first);
    await expect(f.repair.prepare(f.run, 1, f.bad + '\n')).rejects.toThrow();
    await f.receive(first.control, f.good);
    await f.gates.assertResponseReceived(
      {
        taskId: 'demo',
        iteration: 1,
        controlSha256: sha256(f.control),
        response: f.good,
        source: 'BROWSER',
      },
      f.run.policy,
    );
    const original = await readFile(
      path.join(f.root, 'runs', 'demo', 'local', 'format-repair', sha256(f.control), '1.json'),
      'utf8',
    );
    expect(JSON.parse(original).rejectedResponse).toBe(f.bad);
    expect(f.run.state).toBe('PLANNING');
  });

  it('accepts via normal lifecycle only after repaired Browser proof, then supports exact ingress replay', async () => {
    const f = await fixture();
    const snapshots = { capture: async () => ({}) as never, assertLiveSnapshot: async () => {} };
    const lifecycle = new LocalLifecycle(f.root, {} as never, snapshots, f.gates);
    const runFile = path.join(f.root, 'runs', 'demo', 'local', 'run.json');
    const first = await f.repair.prepare(f.run, 1, f.bad);
    await writeFile(runFile, JSON.stringify(f.run));
    const request = {
      taskId: 'demo',
      iteration: 1,
      controlSha256: sha256(f.control),
      response: f.good,
      source: 'BROWSER' as const,
    };
    await expect(lifecycle.beginExecution('demo')).rejects.toThrow();
    await expect(lifecycle.ingest(request)).rejects.toThrow();
    await f.receive(first.control, f.good);
    expect((await lifecycle.ingest(request)).disposition).toBe('ACCEPTED');
    expect((await lifecycle.ingest(request)).disposition).toBe('REPLAY');
    expect((await lifecycle.beginExecution('demo')).state).toBe('EXECUTING');
  });

  it('permits only two sequential attempts and never infers completion of an attempted send', async () => {
    const f = await fixture();
    await expect(f.repair.prepare(f.run, 2, f.bad)).rejects.toThrow();
    const first = await f.repair.prepare(f.run, 1, f.bad);
    await f.receive(first.control, f.bad, 'ATTEMPTED');
    await expect(f.repair.prepare(f.run, 2, f.bad)).rejects.toThrow();
    await f.receive(first.control, f.bad);
    const second = await f.repair.prepare(f.run, 2, f.bad);
    await f.receive(second.control, f.bad);
    await expect(f.repair.prepare(f.run, 3, f.bad)).rejects.toMatchObject({
      code: 'LOCAL_FORMAT_REPAIR_LIMIT',
    });
  });

  it('rejects changed content, identity, valid replies, ambiguous escaping and provider fallback', async () => {
    const f = await fixture();
    expect(() => repairMeaning(f.control, f.good)).toThrow();
    expect(() => repairMeaning(f.control, f.bad.replace('unchanged.', '\\nunchanged.'))).toThrow();
    expect(() =>
      repairMeaning(f.control, f.bad.replace('"mode":"LOCAL"', '"mode":"OTHER"')),
    ).toThrow();
    await expect(
      f.repair.prepare(
        { ...f.run, policy: { ...f.run.policy, browserControlProvider: 'PLAYWRIGHT_CLI' } },
        1,
        f.bad,
      ),
    ).rejects.toThrow();
    const first = await f.repair.prepare(f.run, 1, f.bad);
    const changed = f.good.replace('unchanged.', 'changed.');
    await f.receive(first.control, changed);
    await expect(
      f.gates.assertResponseReceived(
        {
          taskId: 'demo',
          iteration: 1,
          controlSha256: sha256(f.control),
          response: changed,
          source: 'BROWSER',
        },
        f.run.policy,
      ),
    ).rejects.toMatchObject({ code: 'LOCAL_FORMAT_REPAIR_CONTENT_CHANGED' });
  });

  it('fails closed when historical rejected bytes are altered', async () => {
    const f = await fixture();
    const proof = await f.store.read('demo');
    const first = await f.repair.prepare(f.run, 1, f.bad);
    await f.receive(first.control, f.good);
    const file = path.join(
      f.root,
      'runs',
      'demo',
      'codex-browser',
      proof!.operation.operationId,
      'response.txt',
    );
    await writeFile(file, f.bad + '\n');
    await expect(f.repair.responseControl('demo', sha256(f.control), f.good)).rejects.toThrow();
  });
});
