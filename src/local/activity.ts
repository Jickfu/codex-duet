import { access } from 'node:fs/promises';
import path from 'node:path';
import { TaskIdSchema } from '../core/domain.js';
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
