import { z } from 'zod';
import { StateSchema } from './protocol.js';

export const TaskCheckpointSchema = z.object({
  taskId: z.string().min(1).max(128),
  mode: z.enum(['LOCAL', 'GITHUB']),
  iteration: z.number().int().nonnegative(),
  state: StateSchema,
  conversationRef: z.string().min(1).optional(),
  baseRef: z.string().min(1).optional(),
  reviewRef: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type TaskCheckpoint = z.infer<typeof TaskCheckpointSchema>;
