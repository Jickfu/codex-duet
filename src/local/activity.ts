import { access } from 'node:fs/promises';
import path from 'node:path';
import { TaskIdSchema } from '../core/domain.js';
import { ChatbridgeError } from '../core/errors.js';
import type { CodexBrowserControlV1 } from '../duet/codex-browser-control.js';
import { ResponseIngressService } from '../duet/response-ingress.js';
import { GitLocalSnapshotAuthority } from './git-snapshot-authority.js';
import { LocalCodeProvider } from './local-code-provider.js';
import { LocalEvidenceStore } from './evidence-store.js';
import { LocalLifecycle } from './lifecycle.js';
import { StoredLocalLifecycleGates } from './lifecycle-gates.js';
import { LocalTaskSpecStore } from './task-spec.js';

/** Read validated LOCAL activity for shared conversation reservations; unknown is not terminal. */
export async function localTaskActivity(workspace: string, taskIdInput: string) {
  const taskId = TaskIdSchema.parse(taskIdInput);
  const root = path.join(workspace, '.chatbridge');
  let hasRun = true;
  try {
    await access(path.join(root, 'runs', taskId, 'local', 'run.json'));
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
    hasRun = false;
    try {
      await access(path.join(root, 'runs', taskId, 'local', 'provider.json'));
    } catch (missing: any) {
      if (missing?.code === 'ENOENT') return undefined;
      throw missing;
    }
  }
  const snapshots = await GitLocalSnapshotAuthority.open(workspace, taskId);
  const provider = new LocalCodeProvider(snapshots, new LocalEvidenceStore(root), root);
  if (!hasRun) {
    const context = (await provider.status(taskId)).context;
    await new LocalTaskSpecStore(root).read(context);
    return 'PLANNING' as const; // Bound pre-run task may still be completing optional Discussion.
  }
  return (
    await new LocalLifecycle(root, provider, snapshots, new StoredLocalLifecycleGates(root)).status(
      taskId,
    )
  ).state;
}

/** An accepted MCP response completes a control, without fabricating a Browser response. */
export async function localMcpControlCompleted(workspace: string, record: CodexBrowserControlV1) {
  if (record.operation.state !== 'CONFIRMED' || record.operation.kind === 'DISCUSSION')
    return false;
  const taskId = TaskIdSchema.parse(record.taskId);
  const root = path.join(workspace, '.chatbridge');
  try {
    await access(path.join(root, 'runs', taskId, 'local', 'run.json'));
  } catch (error: any) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  let githubExists = true;
  try {
    await access(path.join(root, 'runs', `${taskId}.json`));
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
    githubExists = false;
  }
  if (githubExists)
    throw new ChatbridgeError('Task ID has conflicting modes', 'LOCAL_TASK_MODE_CONFLICT');
  const snapshots = await GitLocalSnapshotAuthority.open(workspace, taskId);
  const provider = new LocalCodeProvider(snapshots, new LocalEvidenceStore(root), root);
  const gates = new StoredLocalLifecycleGates(root);
  const run = await new LocalLifecycle(root, provider, snapshots, gates).status(taskId);
  const response = run.responses.find(
    (r) =>
      r.controlSha256 === record.operation.outboundSha256 &&
      r.iteration === record.operation.iteration,
  );
  if (!response) return false;
  await gates.assertControlConfirmed(taskId, response.controlSha256, run.policy, {
    kind: record.operation.kind,
    iteration: record.operation.iteration,
  });
  const ingress = new ResponseIngressService(root, async () => {
    throw new Error('Read-only completion observer cannot apply a response');
  });
  const receipt = await ingress.status({
    taskId,
    iteration: response.iteration,
    controlSha256: response.controlSha256,
  });
  return (
    receipt?.status === 'ACCEPTED' &&
    Boolean(receipt.acceptedAt) &&
    receipt.source === 'MCP' &&
    receipt.responseSha256 === response.responseSha256
  );
}
