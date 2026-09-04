import path from 'node:path';
import { GitLocalSnapshotAuthority } from './git-snapshot-authority.js';
import { LocalCodeProvider } from './local-code-provider.js';
import { LocalEvidenceStore } from './evidence-store.js';
import { LocalWorkspaceService } from './workspace-service.js';

/** Pins existing task identity; only formal review publication widens its read grant. */
export async function openRemoteWorkspace(root: string, taskId: string) {
  const snapshots = await GitLocalSnapshotAuthority.open(root, taskId);
  const evidence = new LocalEvidenceStore(path.join(root, '.chatbridge'));
  const provider = new LocalCodeProvider(snapshots, evidence, path.join(root, '.chatbridge'));
  const initial = await provider.status(taskId);
  return {
    workspace: new LocalWorkspaceService(snapshots.store, evidence),
    authorizeSnapshot: async (id: string, iteration?: number) => {
      const state = await provider.status(taskId);
      if (
        state.context.workspaceId !== initial.context.workspaceId ||
        state.context.baselineSnapshotId !== initial.context.baselineSnapshotId
      )
        return false;
      const current = state.reviews.at(-1)?.reviewTarget;
      if (iteration !== undefined)
        return state.reviews
          .slice(-2)
          .some((review) => review.iteration === iteration && review.reviewSnapshotId === id);
      return [
        state.context.baselineSnapshotId,
        current?.reviewSnapshotId,
        current?.previousReviewSnapshotId,
      ].includes(id);
    },
  };
}
