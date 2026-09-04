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
import { LocalPlaywrightTransport } from '../../src/local/playwright-transport.js';
import type { BrowserAutomationSession } from '../../src/browser/browser-automation-session.js';

afterEach(() => vi.restoreAllMocks());
async function createFixture(selectedProvider: 'CODEX_BROWSER' | 'PLAYWRIGHT_CLI') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-discussion-'));
  const spec = localSpec();
  const policy = {
    version: 1 as const,
    taskId: 'demo',
    browserControlProvider: selectedProvider,
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
  const create = (segment: 'primary' | 'supplement' = 'primary') =>
    new LocalDiscussion(root, provider as never, snapshots as never, segment);
  const browser = new InteractionService(policies, new CodexBrowserControlStore(root), [
    'https://chatgpt.com',
  ]);
  async function received(control: DiscussionControlV1, outcome: DiscussionResponseV1['outcome']) {
    const file = path.join(root, 'outbound.txt');
    const responseFile = path.join(root, 'inbound.txt');
    const url = 'https://chatgpt.com/c/fixture';
    const response: DiscussionResponseV1 = {
      version: 1,
      kind: 'DISCUSSION_RESPONSE',
      taskId: 'demo',
      provider: selectedProvider,
      iteration: 1,
      round: control.round,
      taskSpecSha256: spec.integrity.sha256,
      controlSha256: sha256(canonicalJson(control)),
      requestSha256: control.requestSha256,
      outcome,
      content: 'Fixture',
    };
    const raw = JSON.stringify(response);
    if (selectedProvider === 'PLAYWRIGHT_CLI') {
      const segment = JSON.parse(control.content).supplement ? 'supplement' : 'primary';
      const sendMessage = vi.fn(async () => ({
        conversationUrl: url,
        outgoingUserMessageId: `user-${control.round}`,
      }));
      const transport = new LocalPlaywrightTransport({
        root,
        activity: { getState: async () => 'PLANNING' },
        outbound: async () => ({
          content: await create(segment).outbound('demo', control.round),
          kind: 'DISCUSSION',
          iteration: 1,
          round: control.round,
        }),
        connect: async () => ({
          selection: { conversationUrl: url },
          connection: { close: async () => {} },
          adapter: {
            isLoggedIn: async () => true,
            sendMessage,
            waitForAssistantMessage: async () => raw,
          } as unknown as BrowserAutomationSession,
        }),
      });
      await transport.send('demo', {}, url);
      expect(sendMessage).toHaveBeenCalledWith(canonicalJson(control) + '\n');
      return transport.wait('demo');
    }
    await writeFile(file, canonicalJson(control) + '\n');
    await browser.prepareCodexBrowser(
      'demo',
      file,
      { kind: 'DISCUSSION', iteration: 1, round: control.round },
      url,
    );
    await browser.markCodexBrowserAttempted('demo');
    await browser.completeCodexBrowser('demo', 'CONFIRMED', url);
    await writeFile(responseFile, raw);
    await browser.recordCodexBrowserResponse('demo', responseFile, url);
    return raw;
  }
  return { root, spec, create, snapshots, policies, policy, received };
}
describe.each(['CODEX_BROWSER', 'PLAYWRIGHT_CLI'] as const)(
  'LOCAL Discussion durable rounds (%s)',
  (selectedProvider) => {
    const fixture = () => createFixture(selectedProvider);
    it('preserves three primary rounds and allows one decision-bound three-round supplement', async () => {
      const f = await fixture();
      let blocked!: DiscussionControlV1;
      let primaryReply = '';
      for (const round of [1, 2, 3]) {
        blocked = await f.create().prepare('demo', round, `Question ${round}`);
        primaryReply = await f.received(
          blocked,
          round === 3 ? 'USER_DECISION_REQUIRED' : 'CONTINUE',
        );
        await f.create().ingest('demo', primaryReply);
      }
      const original = await readFile(
        path.join(f.root, 'runs', 'demo', 'discussion', 'summary.json'),
        'utf8',
      );
      const input = {
        blockedControlSha256: sha256(canonicalJson(blocked) + '\n'),
        decision: 'Keep the existing in-scope behavior.\n',
        scopeUnchanged: true as const,
      };
      const first = await f.create().resume('demo', input);
      expect(first.round).toBe(1);
      expect(first.previousResponseSha256).toBe(sha256(canonicalJson(JSON.parse(primaryReply))));
      expect(JSON.parse(first.content).supplement.decision).toBe(input.decision);
      expect(await f.create().resume('demo', input)).toEqual(first);
      await expect(f.create('supplement').ingest('demo', primaryReply)).rejects.toThrow();
      await expect(new LocalDiscussion(f.root).assertConverged(f.spec, f.policy)).rejects.toThrow();
      for (const round of [1, 2, 3]) {
        const control =
          round === 1
            ? first
            : await f.create('supplement').prepare('demo', round, `Supplement ${round}`);
        await f
          .create('supplement')
          .ingest('demo', await f.received(control, round === 3 ? 'CONVERGED' : 'CONTINUE'));
      }
      expect((await f.create('supplement').status('demo')).status).toBe('CONVERGED');
      expect((await new LocalDiscussion(f.root).assertConverged(f.spec, f.policy))?.decision).toBe(
        input.decision,
      );
      expect(
        await readFile(path.join(f.root, 'runs', 'demo', 'discussion', 'summary.json'), 'utf8'),
      ).toBe(original);
      expect(await f.create().resume('demo', input)).toEqual(first);
      await expect(
        f.create().resume('demo', { ...input, decision: 'Replace it' }),
      ).rejects.toThrow();
      await expect(f.create('supplement').prepare('demo', 4, 'Extra')).rejects.toThrow();
    });

    it.each(['USER_DECISION_REQUIRED', 'FAILED'] as const)(
      'does not restart a supplement that ends with %s',
      async (outcome) => {
        const f = await fixture();
        const primary = await f.create().prepare('demo', 1, 'Question');
        await f.create().ingest('demo', await f.received(primary, 'USER_DECISION_REQUIRED'));
        const input = {
          blockedControlSha256: sha256(canonicalJson(primary) + '\n'),
          decision: 'Clarification',
          scopeUnchanged: true as const,
        };
        const supplement = await f.create().resume('demo', input);
        await f.create('supplement').ingest('demo', await f.received(supplement, outcome));
        await expect(f.create('supplement').prepare('demo', 2, 'Restart')).rejects.toThrow();
        await expect(
          f.create().resume('demo', {
            ...input,
            blockedControlSha256: sha256(canonicalJson(supplement) + '\n'),
          }),
        ).rejects.toThrow();
        await expect(
          new LocalDiscussion(f.root).assertConverged(f.spec, f.policy),
        ).rejects.toThrow();
        expect(await f.create().resume('demo', input)).toEqual(supplement);
        expect((await f.create('supplement').status('demo')).rounds).toHaveLength(1);
      },
    );

    it('recovers decision publication before control and response before summary without reopening primary history', async () => {
      const f = await fixture();
      const primary = await f.create().prepare('demo', 1, 'Question');
      await f.create().ingest('demo', await f.received(primary, 'USER_DECISION_REQUIRED'));
      const input = {
        blockedControlSha256: sha256(canonicalJson(primary) + '\n'),
        decision: 'Clarification',
        scopeUnchanged: true as const,
      };
      vi.spyOn(DiscussionStore.prototype, 'createControl').mockRejectedValueOnce(
        new Error('control crash'),
      );
      await expect(f.create().resume('demo', input)).rejects.toThrow('control crash');
      const decisionFile = path.join(
        f.root,
        'runs',
        'demo',
        'discussion',
        'local-supplement',
        'decision.json',
      );
      const bytes = await readFile(decisionFile, 'utf8');
      await expect(new LocalDiscussion(f.root).assertConverged(f.spec, f.policy)).rejects.toThrow();
      const control = await f.create().resume('demo', input);
      expect(await readFile(decisionFile, 'utf8')).toBe(bytes);
      const raw = await f.received(control, 'CONVERGED');
      vi.spyOn(DiscussionStore.prototype, 'writeSummary').mockRejectedValueOnce(
        new Error('summary crash'),
      );
      await expect(f.create('supplement').ingest('demo', raw)).rejects.toThrow('summary crash');
      await expect(new LocalDiscussion(f.root).assertConverged(f.spec, f.policy)).rejects.toThrow();
      await f.create('supplement').recover('demo');
      expect((await new LocalDiscussion(f.root).assertConverged(f.spec, f.policy))?.decision).toBe(
        input.decision,
      );
    });

    it('rejects unauthorized, stale, changed-scope, oversized, drifted and corrupt supplements', async () => {
      const f = await fixture();
      await expect(f.create('supplement').prepare('demo', 1, 'Question')).rejects.toThrow();
      const primary = await f.create().prepare('demo', 1, 'Question');
      const input = {
        blockedControlSha256: sha256(canonicalJson(primary) + '\n'),
        decision: 'Clarification',
        scopeUnchanged: true as const,
      };
      await expect(f.create().resume('demo', input)).rejects.toThrow();
      await f.create().ingest('demo', await f.received(primary, 'USER_DECISION_REQUIRED'));
      await expect(
        f.create().resume('demo', { ...input, blockedControlSha256: 'f'.repeat(64) }),
      ).rejects.toThrow();
      await expect(
        f.create().resume('demo', { ...input, scopeUnchanged: false } as never),
      ).rejects.toThrow();
      await expect(
        f.create().resume('demo', { ...input, decision: '界'.repeat(4000) }),
      ).rejects.toThrow();
      f.snapshots.assertLiveSnapshot.mockRejectedValueOnce(new Error('drift'));
      await expect(f.create().resume('demo', input)).rejects.toThrow('drift');
      const file = path.join(
        f.root,
        'runs',
        'demo',
        'discussion',
        'local-supplement',
        'decision.json',
      );
      await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
      await f.create().resume('demo', input);
      const decision = JSON.parse(await readFile(file, 'utf8'));
      await writeFile(file, JSON.stringify({ ...decision, decision: 'tampered' }));
      await expect(f.create('supplement').status('demo')).rejects.toThrow();
      await expect(new LocalDiscussion(f.root).assertConverged(f.spec, f.policy)).rejects.toThrow();
    });
    it('rejects CONTINUE at supplemental round three without granting convergence', async () => {
      const f = await fixture();
      const primary = await f.create().prepare('demo', 1, 'Question');
      await f.create().ingest('demo', await f.received(primary, 'USER_DECISION_REQUIRED'));
      let control = await f.create().resume('demo', {
        blockedControlSha256: sha256(canonicalJson(primary) + '\n'),
        decision: 'Clarification',
        scopeUnchanged: true,
      });
      for (const round of [1, 2]) {
        await f.create('supplement').ingest('demo', await f.received(control, 'CONTINUE'));
        control = await f
          .create('supplement')
          .prepare('demo', round + 1, `Supplement ${round + 1}`);
      }
      await expect(
        f.create('supplement').ingest('demo', await f.received(control, 'CONTINUE')),
      ).rejects.toMatchObject({ code: 'DISCUSSION_LIMIT_REACHED' });
      await expect(new LocalDiscussion(f.root).assertConverged(f.spec, f.policy)).rejects.toThrow();
    });
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
        provider: selectedProvider,
        taskSpecSha256: f.spec.integrity.sha256,
        controlSha256: sha256(canonicalJson(control)),
        requestSha256: control.requestSha256,
        outcome: 'CONVERGED',
        content: 'Orphan',
      });
      await expect(f.create().recover('demo')).rejects.toThrow();
    });
  },
);
