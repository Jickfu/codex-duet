import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import { registerLocalCommands } from '../../src/cli/local.js';
import { localRequest, localSpec } from '../fixtures/local-task-spec.js';
import { parseEnvelope, serializeEnvelope } from '../../src/core/protocol.js';
import { canonicalJson, sha256 } from '../../src/duet/task-spec.js';
import { TaskInteractionPolicyStore } from '../../src/duet/interaction-policy-store.js';
import { LocalPlaywrightProofStore } from '../../src/local/playwright-proof.js';
import { LocalMcpLifecycleIngress } from '../../src/local/mcp-lifecycle-ingress.js';
import { LocalMcpCapabilityStore } from '../../src/local/capability-store.js';
import { GitLocalSnapshotAuthority } from '../../src/local/git-snapshot-authority.js';
import { LocalCodeProvider } from '../../src/local/local-code-provider.js';
import { LocalEvidenceStore } from '../../src/local/evidence-store.js';

// Only the external Browser boundary is substituted. CLI, Git, stores and lifecycle are real.
const browser = vi.hoisted(() => ({ sent: [] as string[], response: '', waits: 0 }));
vi.mock('../../src/cli/runtime.js', () => ({
  runtime: async ({ conversationUrl }: { conversationUrl: string }) => ({
    selection: { conversationUrl },
    connection: { close: async () => {} },
    adapter: {
      isLoggedIn: async () => true,
      sendMessage: async (message: string) => {
        browser.sent.push(message);
        return { conversationUrl, outgoingUserMessageId: `user-${browser.sent.length}` };
      },
      waitForAssistantMessage: async () => {
        browser.waits++;
        return browser.response;
      },
    },
  }),
}));

describe('LOCAL Playwright CLI with real Git', () => {
  it('connects Discussion, exact sends, Browser and MCP responses across two review rounds', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'local-playwright-cli-'));
    const execute = promisify(execFile);
    const git = async (...args: string[]) => (await execute('git', args, { cwd: root })).stdout;
    await git('init');
    await git('config', 'user.name', 'Fixture');
    await git('config', 'user.email', 'fixture@example.test');
    await writeFile(path.join(root, 'tracked.txt'), 'baseline\n');
    await git('add', 'tracked.txt');
    await git('commit', '-m', 'baseline');
    const head = await git('rev-parse', 'HEAD');
    await mkdir(path.join(root, 'docs', 'contracts'), { recursive: true });
    for (const name of ['local-planner-v1.md', 'local-reviewer-v1.md'])
      await writeFile(
        path.join(root, 'docs', 'contracts', name),
        await readFile(path.resolve('docs', 'contracts', name)),
      );
    const cli = async (...args: string[]): Promise<any> => {
      const program = new Command().exitOverride();
      let result: unknown;
      registerLocalCommands(
        program,
        () => root,
        (value) => {
          result = value;
        },
      );
      await program.parseAsync(['local', ...args], { from: 'user' });
      return result;
    };
    const context = await cli('init-task', '--task', 'demo');
    const stateRoot = path.join(root, '.chatbridge');
    const inputFile = path.join(stateRoot, 'input.txt');
    const specFile = path.join(stateRoot, 'spec.json');
    await writeFile(inputFile, localRequest);
    await writeFile(specFile, JSON.stringify(localSpec(context)));
    await cli(
      'bind-task-spec',
      '--task',
      'demo',
      '--request-file',
      inputFile,
      '--task-spec-file',
      specFile,
    );
    await new TaskInteractionPolicyStore(stateRoot).createOrVerify({
      version: 1,
      taskId: 'demo',
      browserControlProvider: 'PLAYWRIGHT_CLI',
      discussion: { enabled: true },
      selectedAt: new Date(0).toISOString(),
    });
    await writeFile(inputFile, 'Discuss the accepted task');
    const discussion = (
      await cli('discussion-prepare', '--task', 'demo', '--round', '1', '--request-file', inputFile)
    ).control;
    const url = 'https://chatgpt.com/c/local-fixture';
    const proofStore = new LocalPlaywrightProofStore(stateRoot);
    const discussionProof = await cli(
      'browser-send',
      '--task',
      'demo',
      '--round',
      '1',
      '--conversation-url',
      url,
    );
    expect(browser.sent.at(-1)).toBe(canonicalJson(discussion) + '\n');
    browser.response = canonicalJson({
      version: 1,
      kind: 'DISCUSSION_RESPONSE',
      taskId: 'demo',
      provider: 'PLAYWRIGHT_CLI',
      iteration: 1,
      round: 1,
      taskSpecSha256: discussion.taskSpecSha256,
      controlSha256: sha256(canonicalJson(discussion)),
      requestSha256: discussion.requestSha256,
      outcome: 'CONVERGED',
      content: 'Proceed within scope',
    });
    await cli('browser-wait', '--task', 'demo', '--timeout', '1000');
    await cli(
      'discussion-ingest',
      '--task',
      'demo',
      '--message-file',
      proofStore.artifactPath('demo', discussionProof.operation.operationId, 'response'),
    );
    let run = await cli('run-init', '--task', 'demo');
    const reply = (control: string, state: 'PLAN' | 'DONE') => {
      const envelope = parseEnvelope(control);
      return serializeEnvelope({
        ...envelope,
        state,
        iteration:
          state === 'PLAN' && envelope.state === 'EXECUTED'
            ? envelope.iteration + 1
            : envelope.iteration,
        content: JSON.stringify({
          identity: JSON.parse(envelope.content).identity,
          result: 'Fixture result',
        }),
      });
    };
    const planner = await cli('browser-send', '--task', 'demo');
    expect(browser.sent.at(-1)).toBe(run.control);
    await cli('confirm-control', '--task', 'demo');
    browser.response = reply(run.control, 'PLAN');
    await cli('browser-wait', '--task', 'demo');
    await cli(
      'ingest-response',
      '--task',
      'demo',
      '--message-file',
      proofStore.artifactPath('demo', planner.operation.operationId, 'response'),
    );
    const snapshots = await GitLocalSnapshotAuthority.open(root, 'demo');
    const capabilities = new LocalMcpCapabilityStore(stateRoot);
    const mcp = new LocalMcpLifecycleIngress(
      stateRoot,
      new LocalCodeProvider(snapshots, new LocalEvidenceStore(stateRoot), stateRoot),
      snapshots,
      capabilities,
    );
    let recoverMcp: (() => Promise<void>) | undefined;
    for (const iteration of [1, 2]) {
      await cli('begin-execution', '--task', 'demo');
      const sendsBefore = browser.sent.length;
      await expect(cli('browser-send', '--task', 'demo')).rejects.toThrow();
      expect(browser.sent).toHaveLength(sendsBefore);
      await writeFile(path.join(root, 'tracked.txt'), `change ${iteration}\n`);
      const capture = await cli('capture', '--task', 'demo');
      const identity = { version: 1, taskId: 'demo', iteration, snapshotId: capture.snapshotId };
      await writeFile(
        inputFile,
        JSON.stringify({
          tests: {
            ...identity,
            status: 'PASS',
            summary: 'Fixture',
            recordedAt: new Date(0).toISOString(),
          },
          execution: { ...identity, summary: 'Changed tracked.txt' },
        }),
      );
      await cli('record-evidence', '--task', 'demo', '--evidence-file', inputFile);
      run = await cli('run-prepare-review', '--task', 'demo');
      if (recoverMcp) {
        await expect(cli('browser-send', '--task', 'demo')).rejects.toMatchObject({
          code: 'LOCAL_PLAYWRIGHT_RESPONSE_PENDING',
        });
        await recoverMcp();
      }
      const reviewProof = await cli('browser-send', '--task', 'demo');
      expect(browser.sent.at(-1)).toBe(run.control);
      await cli('confirm-control', '--task', 'demo');
      const response = reply(run.control, iteration === 1 ? 'PLAN' : 'DONE');
      if (iteration === 1) {
        const binding = { taskId: 'demo', iteration, controlSha256: sha256(run.control) };
        const credential = await capabilities.issue(binding);
        await mcp.accept({ ...binding, source: 'MCP', response }, credential);
        expect((await proofStore.read('demo'))?.operation.state).toBe('CONFIRMED');
        const receiptFile = path.join(
          stateRoot,
          'runs',
          'demo',
          'ingress',
          '1',
          `${binding.controlSha256}.json`,
        );
        const receipt = JSON.parse(await readFile(receiptFile, 'utf8'));
        delete receipt.acceptedAt;
        await writeFile(receiptFile, JSON.stringify({ ...receipt, status: 'PENDING' }));
        recoverMcp = async () => {
          await mcp.accept({ ...binding, source: 'MCP', response }, credential);
        };
      } else {
        browser.response = response;
        await cli('browser-wait', '--task', 'demo');
        await cli(
          'ingest-response',
          '--task',
          'demo',
          '--message-file',
          proofStore.artifactPath('demo', reviewProof.operation.operationId, 'response'),
        );
      }
    }
    expect((await cli('run-status', '--task', 'demo')).state).toBe('DONE');
    await expect(cli('browser-send', '--task', 'demo')).rejects.toThrow();
    expect(browser.sent).toHaveLength(4);
    expect(browser.waits).toBe(3);
    expect(await git('rev-parse', 'HEAD')).toBe(head);
    expect((await git('remote')).trim()).toBe('');
  }, 120000);
});
