import { z } from 'zod';
import { CodexBrowserControlV1Schema } from './codex-browser-control.js';
import { canonicalJson, sha256 } from './task-spec.js';

/** Immutable intent, published before changing the active binding. */
export const CodexBrowserHandoffSchema = z
  .object({
    version: z.literal(1),
    before: CodexBrowserControlV1Schema,
    after: CodexBrowserControlV1Schema,
    localRun: z.string(),
    reason: z.string().trim().min(1).max(4096),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      !v.before.conversationUrl ||
      !v.after.conversationUrl ||
      v.before.conversationUrl === v.after.conversationUrl ||
      v.before.operation.state !== 'PREPARED' ||
      v.before.operation.kind !== 'REVIEWER' ||
      canonicalJson({ ...v.before, conversationUrl: v.after.conversationUrl }) !==
        canonicalJson(v.after) ||
      v.before.operation.operationId !==
        sha256(
          JSON.stringify({
            taskId: v.before.taskId,
            kind: 'REVIEWER',
            iteration: v.before.operation.iteration,
            outboundSha256: v.before.operation.outboundSha256,
          }),
        )
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid conversation handoff identity' });
  });
export type CodexBrowserHandoff = z.infer<typeof CodexBrowserHandoffSchema>;
