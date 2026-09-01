import { TaskIdSchema } from '../core/domain.js';
export { FullShaSchema, RepositorySchema } from '../core/github-fields.js';
import { RepositorySchema } from '../core/github-fields.js';

export function taskBranchFor(taskId: string): string {
  return `agent/task-${TaskIdSchema.parse(taskId)}`;
}

export function parseGitHubRemote(url: string): string {
  const trimmed = url.trim();
  const match = trimmed.match(
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/,
  );
  if (!match) throw new Error('UNSUPPORTED_GIT_REMOTE');
  return RepositorySchema.parse(`${match[1]}/${match[2]}`);
}
