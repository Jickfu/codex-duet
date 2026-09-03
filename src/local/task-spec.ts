import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ChatbridgeError } from '../core/errors.js';
import { TaskIdSchema } from '../core/domain.js';
import { TaskSpecV1Schema, canonicalJson, sha256 } from '../duet/task-spec.js';
import { LocalContextRefSchema, type LocalContextRef } from './domain.js';
import { createImmutableJson } from './immutable-json.js';
import type { LocalSnapshotStore } from './snapshot-store.js';

/** Separate additive variant; the frozen GITHUB TaskSpec schema is unchanged. */
export const LocalTaskSpecV1Schema = TaskSpecV1Schema.extend({
  mode: z.literal('LOCAL'),
  context: LocalContextRefSchema,
  contracts: z
    .object({
      plannerPath: z.literal('docs/contracts/local-planner-v1.md'),
      reviewerPath: z.literal('docs/contracts/local-reviewer-v1.md'),
      resolution: z.literal('AT_BASELINE_SNAPSHOT'),
    })
    .strict(),
});
export type LocalTaskSpecV1 = z.infer<typeof LocalTaskSpecV1Schema>;

export function validateLocalTaskSpec(
  value: unknown,
  context: LocalContextRef,
  rawRequest?: string,
): LocalTaskSpecV1 {
  const spec = LocalTaskSpecV1Schema.parse(value);
  const expected = LocalContextRefSchema.parse(context);
  if (spec.taskId !== expected.taskId || canonicalJson(spec.context) !== canonicalJson(expected))
    throw new ChatbridgeError('LOCAL TaskSpec context mismatch', 'TASK_SPEC_CONTEXT_MISMATCH');
  const { integrity, ...content } = spec;
  if (integrity.sha256 !== sha256(canonicalJson(content)))
    throw new ChatbridgeError('LOCAL TaskSpec integrity mismatch', 'TASK_SPEC_INTEGRITY_INVALID');
  if (rawRequest !== undefined) {
    if (spec.source.rawRequestSha256 !== sha256(rawRequest))
      throw new ChatbridgeError('LOCAL raw request mismatch', 'TASK_SPEC_REQUEST_MISMATCH');
    for (const literal of spec.exactLiterals) {
      if (!literal.usage.startsWith('SYSTEM_GENERATED:') && !rawRequest.includes(literal.value))
        throw new ChatbridgeError(
          'LOCAL exact literal missing from request',
          'TASK_SPEC_LITERAL_MISMATCH',
        );
    }
  }
  return spec;
}

export async function assertLocalContracts(
  spec: LocalTaskSpecV1,
  store: LocalSnapshotStore,
): Promise<void> {
  const manifest = await store.read(spec.taskId, spec.context.baselineSnapshotId);
  if (manifest.snapshot.workspaceId !== spec.context.workspaceId)
    throw new ChatbridgeError('LOCAL contract workspace mismatch', 'TASK_SPEC_CONTEXT_MISMATCH');
  for (const name of [spec.contracts.plannerPath, spec.contracts.reviewerPath]) {
    const entry = manifest.entries.find((file) => file.path === name);
    if (!entry)
      throw new ChatbridgeError('LOCAL contract absent from baseline', 'LOCAL_CONTRACT_MISSING');
    const bytes = await store.readBlob(entry.blobSha256);
    if (bytes.length === 0 || bytes.length !== entry.bytes)
      throw new ChatbridgeError('LOCAL contract blob invalid', 'LOCAL_CONTRACT_INVALID');
  }
}

export class LocalTaskSpecStore {
  constructor(private readonly root: string) {}
  async read(context: LocalContextRef): Promise<LocalTaskSpecV1> {
    return validateLocalTaskSpec(
      JSON.parse(await readFile(this.file(context.taskId), 'utf8')),
      context,
    );
  }
  async createOrVerify(spec: LocalTaskSpecV1, context: LocalContextRef): Promise<void> {
    await createImmutableJson(this.file(context.taskId), validateLocalTaskSpec(spec, context));
  }
  private file(taskId: string): string {
    return path.join(this.root, 'runs', TaskIdSchema.parse(taskId), 'local', 'task-spec.json');
  }
}
