import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexBrowserControlStore } from '../../src/duet/codex-browser-control-store.js';
import { InteractionService } from '../../src/duet/interaction-service.js';
import { TaskInteractionPolicyStore } from '../../src/duet/interaction-policy-store.js';
import { TaskInteractionPolicyV1Schema } from '../../src/duet/interaction-policy.js';

const roots: string[] = [];
const policy = {
  version: 1 as const,
  taskId: 'demo',
  browserControlProvider: 'CODEX_BROWSER' as const,
  discussion: { enabled: true },
  selectedAt: new Date(0).toISOString(),
};

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'interaction-'));
  roots.push(root);
  const stateRoot = path.join(root, '.chatbridge');
  const policies = new TaskInteractionPolicyStore(stateRoot);
  const service = new InteractionService(
    policies,
    new CodexBrowserControlStore(stateRoot),
    ['https://chatgpt.com'],
    () => new Date(1).toISOString(),
  );
  return { root, policies, service };
}

describe('task interaction policy', () => {
  it('is strict, explicit, and immutable', async () => {
    expect(TaskInteractionPolicyV1Schema.parse(policy)).toEqual(policy);
    expect(() => TaskInteractionPolicyV1Schema.parse({ ...policy, extra: true })).toThrow();
    const x = await fixture();
    await x.policies.createOrVerify(policy);
    await x.policies.createOrVerify(policy);
    await expect(
      x.policies.createOrVerify({ ...policy, browserControlProvider: 'PLAYWRIGHT_CLI' }),
    ).rejects.toMatchObject({ code: 'INTERACTION_POLICY_IMMUTABLE' });
  });

  it('routes fail closed while preserving legacy tasks without a policy', async () => {
    const x = await fixture();
    expect(await x.service.requireProvider('legacy', 'PLAYWRIGHT_CLI')).toBeUndefined();
    const message = path.join(x.root, 'legacy.txt');
    await writeFile(message, 'legacy', 'utf8');
    await expect(
      x.service.prepareCodexBrowser('legacy', message, { kind: 'PLANNER', iteration: 1 }),
    ).rejects.toMatchObject({ code: 'INTERACTION_POLICY_REQUIRED' });
    await x.policies.createOrVerify(policy);
    await expect(x.service.requireProvider('demo', 'PLAYWRIGHT_CLI')).rejects.toMatchObject({
      code: 'BROWSER_PROVIDER_MISMATCH',
    });
  });

  it('allows explicit policy correction only before first durable preparation', async () => {
    const x = await fixture();
    const first = path.join(x.root, 'first.json');
    const second = path.join(x.root, 'second.json');
    await writeFile(first, JSON.stringify(policy), 'utf8');
    await writeFile(
      second,
      JSON.stringify({ ...policy, browserControlProvider: 'PLAYWRIGHT_CLI' }),
      'utf8',
    );
    await x.service.initialize('demo', first);
    await x.service.initialize('demo', second);
    expect((await x.policies.read('demo'))?.browserControlProvider).toBe('PLAYWRIGHT_CLI');
    await x.policies.lock('demo');
    await expect(x.service.initialize('demo', first)).rejects.toMatchObject({
      code: 'INTERACTION_POLICY_IMMUTABLE',
    });
  });

  it('checkpoints CODEX_BROWSER confirmation and forbids replay after uncertainty', async () => {
    const x = await fixture();
    await x.policies.createOrVerify(policy);
    const message = path.join(x.root, 'message.txt');
    await writeFile(message, 'hello', 'utf8');
    await x.service.prepareCodexBrowser('demo', message, { kind: 'PLANNER', iteration: 1 });
    await expect(x.service.completeCodexBrowser('demo', 'CONFIRMED')).rejects.toMatchObject({
      code: 'CODEX_BROWSER_OPERATION_MISSING',
    });
    await x.service.markCodexBrowserAttempted('demo');
    await expect(x.service.completeCodexBrowser('demo', 'CONFIRMED')).rejects.toMatchObject({
      code: 'CHATGPT_CONVERSATION_IDENTITY_REQUIRED',
    });
    const confirmed = await x.service.completeCodexBrowser(
      'demo',
      'CONFIRMED',
      'https://chatgpt.com/c/abc?ignored=1',
    );
    expect(confirmed.conversationUrl).toBe('https://chatgpt.com/c/abc?ignored=1');
    const response = path.join(x.root, 'response.txt');
    await writeFile(response, 'reply', 'utf8');
    expect(
      (
        await x.service.recordCodexBrowserResponse(
          'demo',
          response,
          'https://chatgpt.com/c/abc?ignored=1',
        )
      ).operation.state,
    ).toBe('RESPONDED');
    await expect(
      x.service.prepareCodexBrowser(
        'demo',
        message,
        { kind: 'REVIEWER', iteration: 1 },
        'https://chatgpt.com/c/other',
      ),
    ).rejects.toMatchObject({ code: 'CHATGPT_CONVERSATION_BINDING_CONFLICT' });
    await expect(x.service.assertCodexBrowserInbound('demo', response)).resolves.toBeUndefined();
    await writeFile(response, 'different reply', 'utf8');
    await expect(x.service.assertCodexBrowserInbound('demo', response)).rejects.toMatchObject({
      code: 'CODEX_BROWSER_RESPONSE_MISMATCH',
    });

    await x.service.prepareCodexBrowser(
      'demo',
      message,
      { kind: 'REVIEWER', iteration: 1 },
      'https://chatgpt.com/c/abc?ignored=1',
    );
    await x.service.markCodexBrowserAttempted('demo');
    await x.service.completeCodexBrowser('demo', 'OUTCOME_UNKNOWN');
    await expect(
      x.service.prepareCodexBrowser('demo', message, { kind: 'REVIEWER', iteration: 1 }),
    ).rejects.toMatchObject({ code: 'CODEX_BROWSER_RESEND_FORBIDDEN' });
  });
});
