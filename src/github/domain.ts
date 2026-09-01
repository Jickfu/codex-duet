import { z } from 'zod';

export const FullShaSchema = z.string().regex(/^[0-9a-f]{40}$/, 'Expected a full 40-character SHA');
export const TaskIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid task ID');
export const RepositorySchema = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'Expected GitHub owner/repository');
export const TestStatusSchema = z.enum(['PASS', 'FAIL', 'NOT_RUN']);

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
