import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalDiscussion } from '../../src/local/discussion.js';
import { LocalTaskSpecStore } from '../../src/local/task-spec.js';
import { TaskInteractionPolicyStore } from '../../src/duet/interaction-policy-store.js';
import { DiscussionStore } from '../../src/duet/discussion-store.js';
import { CodexBrowserControlStore } from '../../src/duet/codex-browser-control-store.js';
import { InteractionService } from '../../src/duet/interaction-service.js';
import type { DiscussionControlV1, DiscussionResponseV1 } from '../../src/duet/discussion.js';
import { canonicalJson, sha256 } from '../../src/duet/task-spec.js';
import { localSpec } from '../fixtures/local-task-spec.js';

afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-discussion-'));
  const spec = localSpec();
  const policy = {
    version: 1 as const,
    taskId: 'demo',
    browserControlProvider: 'CODEX_BROWSER' as const,
    discussion: { enabled: true },
    selectedAt: new Date(0).toISOString(),
  };
  await new LocalTaskSpecStore(root).createOrVerify(spec, spec.context);
  const policies = new TaskInteractionPolicyStore(root);
  await policies.createOrVerify(policy);
  const snapshots = {
    assertLiveSnapshot: vi.fn(async () => {}),
    store: {
      async read() {
        return {
          snapshot: { workspaceId: spec.context.workspaceId },
          entries: [spec.contracts.plannerPath, spec.contracts.reviewerPath].map((name) => ({
            path: name,
            blobSha256: 'a'.repeat(64),
            bytes: 8,
          })),
        };
      },
      async readBlob() {
        return Buffer.from('contract');
      },
    },
  };
  const provider = {
    async status() {
      return { context: spec.context, reviews: [] };
    },
  };
  const create = () => new LocalDiscussion(root, provider as never, snapshots as never);
  const browser = new InteractionService(policies, new CodexBrowserControlStore(root), [
    'https://chatgpt.com',
  ]);
  async function received(control: DiscussionControlV1, outcome: DiscussionResponseV1['outcome']) {
    const file = path.join(root, 'outbound.txt');
    const responseFile = path.join(root, 'inbound.txt');
    const url = 'https://chatgpt.com/c/fixture';
    await writeFile(file, canonicalJson(control) + '\n');
    await browser.prepareCodexBrowser(
      'demo',
      file,
      { kind: 'DISCUSSION', iteration: 1, round: control.round },
      url,
    );
    await browser.markCodexBrowserAttempted('demo');
    await browser.completeCodexBrowser('demo', 'CONFIRMED', url);
    const response: DiscussionResponseV1 = {
      version: 1,
      kind: 'DISCUSSION_RESPONSE',
      taskId: 'demo',
      provider: 'CODEX_BROWSER',
      iteration: 1,
      round: control.round,
      taskSpecSha256: spec.integrity.sha256,
      controlSha256: sha256(canonicalJson(control)),
      requestSha256: control.requestSha256,
      outcome,
      content: 'Fixture',
    };
    const raw = JSON.stringify(response);
    await writeFile(responseFile, raw);
    await browser.recordCodexBrowserResponse('demo', responseFile, url);
    return raw;
  }
  return { root, spec, create, snapshots, policies, policy, received };
}
describe('LOCAL Discussion durable rounds', () => {
  it('continues sequentially then converges, preserving identities and exact retry', async () => {
    const f = await fixture();
    const first = await f.create().prepare('demo', 1, 'Question');
    expect(JSON.parse(first.content).context).toEqual(f.spec.context);
    expect(await f.create().prepare('demo', 1, 'Question')).toEqual(first);
    await expect(f.create().prepare('demo', 1, 'Different')).rejects.toThrow();
    await expect(f.create().prepare('demo', 2, 'Next')).rejects.toThrow();
    const raw = await f.received(first, 'CONTINUE');
    await f.create().ingest('demo', raw);
    const second = await f.create().prepare('demo', 2, 'Next');
    expect(second.previousResponseSha256).toBe(sha256(canonicalJson(JSON.parse(raw))));
    const final = await f.received(second, 'CONVERGED');
    await f.create().ingest('demo', final);
    expect((await f.create().status('demo')).status).toBe('CONVERGED');
    await expect(f.create().prepare('demo', 3, 'Unneeded')).rejects.toThrow();
    await f.create().ingest('demo', raw); // Historical replay after Browser moved to another round.
    await expect(f.create().ingest('demo', raw + '\n')).rejects.toThrow();
  });
  it('repairs control and response publication before summary without allocating another round', async () => {
    const f = await fixture();
    const failure = vi
      .spyOn(DiscussionStore.prototype, 'writeSummary')
      .mockRejectedValueOnce(new Error('crash'));
    await expect(f.create().prepare('demo', 1, 'Question')).rejects.toThrow('crash');
    const control = await f.create().prepare('demo', 1, 'Question');
    expect((await f.create().status('demo')).rounds).toHaveLength(1);
    const raw = await f.received(control, 'CONVERGED');
    failure.mockRejectedValueOnce(new Error('crash'));
    await expect(f.create().ingest('demo', raw)).rejects.toThrow('crash');
    expect((await f.create().status('demo')).status).toBe('CONVERGED');
    await f.create().recover('demo');
    await f.create().ingest('demo', raw);
    expect((await new DiscussionStore(f.root).readSummary('demo'))?.status).toBe('CONVERGED');
  });
  it.each(['USER_DECISION_REQUIRED', 'FAILED'] as const)(
    'keeps %s terminal without auto-continuation',
    async (outcome) => {
      const f = await fixture();
      const control = await f.create().prepare('demo', 1, 'Question');
      await f.create().ingest('demo', await f.received(control, outcome));
      expect((await f.create().status('demo')).status).toBe(
        outcome === 'FAILED' ? 'FAILED' : 'BLOCKED',
      );
      await expect(f.create().prepare('demo', 2, 'Next')).rejects.toThrow();
    },
  );
  it('fails before publication on overflow and on drift at initial response acceptance', async () => {
    const f = await fixture();
    await expect(f.create().prepare('demo', 1, '界'.repeat(4000))).rejects.toThrow();
    expect((await f.create().status('demo')).rounds).toEqual([]);
    const control = await f.create().prepare('demo', 1, 'Question');
    const raw = await f.received(control, 'CONVERGED');
    f.snapshots.assertLiveSnapshot.mockRejectedValueOnce(new Error('drift'));
    await expect(f.create().ingest('demo', raw)).rejects.toThrow('drift');
    await expect(
      readFile(path.join(f.root, 'runs', 'demo', 'discussion', 'round-1', 'response.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await f.create().ingest('demo', raw);
  });
  it('refuses a fourth round and CONTINUE at the third round', async () => {
    const f = await fixture();
    for (const round of [1, 2]) {
      const control = await f.create().prepare('demo', round, `Question ${round}`);
      await f.create().ingest('demo', await f.received(control, 'CONTINUE'));
    }
    const third = await f.create().prepare('demo', 3, 'Last question');
    await expect(
      f.create().ingest('demo', await f.received(third, 'CONTINUE')),
    ).rejects.toMatchObject({ code: 'DISCUSSION_LIMIT_REACHED' });
    await expect(f.create().prepare('demo', 4, 'Fourth')).rejects.toThrow();
  });
  it('does not recover fabricated summary outcomes or orphan responses', async () => {
    const f = await fixture();
    const control = await f.create().prepare('demo', 1, 'Question');
    const store = new DiscussionStore(f.root);
    const summary = (await store.readSummary('demo'))!;
    await store.writeSummary({
      ...summary,
      status: 'CONVERGED',
      rounds: [{ ...summary.rounds[0]!, outcome: 'CONVERGED', responseSha256: 'e'.repeat(64) }],
    });
    await expect(f.create().recover('demo')).rejects.toThrow();
    await store.writeSummary(summary);
    await store.createResponse({
      version: 1,
      kind: 'DISCUSSION_RESPONSE',
      taskId: 'demo',
      iteration: 1,
      round: 2,
      provider: 'CODEX_BROWSER',
      taskSpecSha256: f.spec.integrity.sha256,
      controlSha256: sha256(canonicalJson(control)),
      requestSha256: control.requestSha256,
      outcome: 'CONVERGED',
      content: 'Orphan',
    });
    await expect(f.create().recover('demo')).rejects.toThrow();
  });
});
