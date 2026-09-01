import { z } from 'zod';

export const FullShaSchema = z.string().regex(/^[0-9a-f]{40}$/, 'Expected a full 40-character SHA');
export const RepositorySchema = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'Expected GitHub owner/repository');
export const RemoteNameSchema = z.string().regex(/^[A-Za-z0-9._-]+$/);
export const TaskBranchSchema = z.string().regex(/^agent\/task-[A-Za-z0-9_-]{1,64}$/);
