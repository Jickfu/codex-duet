import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DiscussionService } from '../../src/duet/discussion-service.js';
import { DiscussionStore } from '../../src/duet/discussion-store.js';
import { TaskInteractionPolicyStore } from '../../src/duet/interaction-policy-store.js';
import { DuetRunStore } from '../../src/duet/run-store.js';
import { TaskSpecStore } from '../../src/duet/task-spec-store.js';
import {
  sha256,
  taskSpecFingerprint,
  type TaskSpecWithoutIntegrity,
} from '../../src/duet/task-spec.js';

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((x) => rm(x, { recursive: true, force: true }))),
);

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'discussion-'));
  roots.push(root);
  const state = path.join(root, '.chatbridge');
  const runs = new DuetRunStore(state);
  const policies = new TaskInteractionPolicyStore(state);
  const specs = new TaskSpecStore(state);
  const discussions = new DiscussionStore(state);
  const now = new Date(0).toISOString();
  await runs.write({
    version: 2,
    taskId: 'demo',
    mode: 'GITHUB',
    iteration: 1,
    state: 'PLANNING',
    context: {
      mode: 'GITHUB',
      repository: 'owner/repo',
      remote: 'origin',
      taskId: 'demo',
      taskBranch: 'agent/task-demo',
      baseRef: 'a'.repeat(40),
    },
    request: { sha256: 'b'.repeat(64) },
    iterations: [],
    limits: { maxIterations: 8 },
    createdAt: now,
    updatedAt: now,
  });
  await policies.createOrVerify({
    version: 1,
    taskId: 'demo',
    browserControlProvider: 'CODEX_BROWSER',
    discussion: { enabled: true },
    selectedAt: now,
  });
  const content: TaskSpecWithoutIntegrity = {
    version: 1,
    taskId: 'demo',
    mode: 'GITHUB',
    objective: 'Discuss first',
    scope: { allowed: ['src'], forbidden: ['M5'] },
    acceptanceCriteria: [],
    exactLiterals: [],
    protocolRequirements: [],
    context: { repository: 'owner/repo', taskBranch: 'agent/task-demo', baseRef: 'a'.repeat(40) },
    source: { rawRequestSha256: sha256('request') },
    contracts: {
      plannerPath: 'docs/contracts/planner-v1.md',
      reviewerPath: 'docs/contracts/reviewer-v1.md',
      resolution: 'AT_BASE_REF',
    },
  };
  await specs.createOrVerify({ ...content, integrity: { sha256: taskSpecFingerprint(content) } });
  return { root, service: new DiscussionService(runs, policies, specs, discussions) };
}

describe('bounded pre-planning Discussion', () => {
  it('uses a separate strict envelope and gates Planner until convergence', async () => {
    const x = await fixture();
    const request = path.join(x.root, 'request.txt');
    const output = path.join(x.root, 'control.json');
    await writeFile(request, 'Resolve the architecture.', 'utf8');
    const control = await x.service.prepare('demo', request, output);
    await expect(x.service.prepare('demo', request, output)).rejects.toMatchObject({
      code: 'DISCUSSION_RESPONSE_PENDING',
    });
    expect(JSON.parse(await readFile(output, 'utf8'))).toMatchObject({
      kind: 'DISCUSSION_CONTROL',
      round: 1,
    });
    await expect(x.service.assertPlannerAllowed('demo')).rejects.toMatchObject({
      code: 'DISCUSSION_NOT_CONVERGED',
    });
    const response = path.join(x.root, 'response.json');
    await writeFile(
      response,
      JSON.stringify({
        version: 1,
        kind: 'DISCUSSION_RESPONSE',
        taskId: 'demo',
        iteration: 1,
        round: 1,
        provider: 'CODEX_BROWSER',
        taskSpecSha256: control.taskSpecSha256,
        requestSha256: control.requestSha256,
        outcome: 'CONVERGED',
        content: 'Agreed.',
      }),
      'utf8',
    );
    await x.service.ingest('demo', response);
    await expect(x.service.assertPlannerAllowed('demo')).resolves.toBeUndefined();
  });

  it('rejects malformed or cross-task authority', async () => {
    const x = await fixture();
    const request = path.join(x.root, 'request.txt');
    const output = path.join(x.root, 'control.json');
    await writeFile(request, 'Question', 'utf8');
    const control = await x.service.prepare('demo', request, output);
    const response = path.join(x.root, 'response.json');
    await writeFile(
      response,
      JSON.stringify({
        version: 1,
        kind: 'DISCUSSION_RESPONSE',
        taskId: 'other',
        iteration: 1,
        round: 1,
        provider: 'CODEX_BROWSER',
        taskSpecSha256: control.taskSpecSha256,
        requestSha256: control.requestSha256,
        outcome: 'CONVERGED',
        content: 'No.',
      }),
      'utf8',
    );
    await expect(x.service.ingest('demo', response)).rejects.toMatchObject({
      code: 'DISCUSSION_IDENTITY_MISMATCH',
    });
  });
});
