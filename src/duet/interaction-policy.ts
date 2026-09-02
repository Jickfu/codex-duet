import { z } from 'zod';
import { TaskIdSchema } from '../core/domain.js';

export const BrowserControlProviderSchema = z.enum(['CODEX_BROWSER', 'PLAYWRIGHT_CLI']);
export type BrowserControlProvider = z.infer<typeof BrowserControlProviderSchema>;

export const TaskInteractionPolicyV1Schema = z
  .object({
    version: z.literal(1),
    taskId: TaskIdSchema,
    browserControlProvider: BrowserControlProviderSchema,
    discussion: z.object({ enabled: z.boolean() }).strict(),
    selectedAt: z.string().datetime(),
  })
  .strict();

export type TaskInteractionPolicyV1 = z.infer<typeof TaskInteractionPolicyV1Schema>;
