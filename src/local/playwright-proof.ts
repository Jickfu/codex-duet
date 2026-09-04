import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { TaskIdSchema } from '../core/domain.js';
import { ChatbridgeError } from '../core/errors.js';
import { ConversationUrlPolicy } from '../browser/conversation-url.js';
import { Sha256Schema } from './domain.js';
import { sha256 } from '../duet/task-spec.js';

const MessageId = z.string().regex(/^[A-Za-z0-9_-]+$/);
export const PlaywrightProofSchema = z
  .object({
    version: z.literal(1),
    taskId: TaskIdSchema,
    provider: z.literal('PLAYWRIGHT_CLI'),
    conversationUrl: z.string().url(),
    operation: z
      .object({
        operationId: Sha256Schema,
        kind: z.enum(['DISCUSSION', 'PLANNER', 'REVIEWER']),
        iteration: z.number().int().positive(),
        round: z.number().int().min(1).max(3).optional(),
        outboundSha256: Sha256Schema,
        state: z.enum(['ATTEMPTED', 'CONFIRMED', 'RESPONDED']),
        preparedAt: z.string().datetime(),
        completedAt: z.string().datetime().optional(),
        inboundSha256: Sha256Schema.optional(),
      })
      .strict(),
    marker: z
      .object({
        conversationUrl: z.string().url(),
        outgoingUserMessageId: MessageId,
        previousAssistantMessageId: MessageId.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const { operation: op } = value;
    const { kind, iteration, round, outboundSha256 } = op;
    const id = sha256(
      JSON.stringify({
        taskId: value.taskId,
        kind,
        iteration,
        ...(round === undefined ? {} : { round }),
        outboundSha256,
      }),
    );
    if (
      (kind === 'DISCUSSION') !== (round !== undefined) ||
      id !== op.operationId ||
      (op.state === 'ATTEMPTED' && (value.marker || op.completedAt)) ||
      (op.state !== 'ATTEMPTED' && (!value.marker || !op.completedAt)) ||
      (op.state === 'RESPONDED') !== (op.inboundSha256 !== undefined) ||
      (value.marker && value.marker.conversationUrl !== value.conversationUrl)
    )
      ctx.addIssue({ code: 'custom', message: 'Inconsistent LOCAL Playwright proof' });
  });
export type PlaywrightProof = z.infer<typeof PlaywrightProofSchema>;

/** LOCAL-only sidecar; never promotes a legacy browser.json marker into exact-send authority. */
export class LocalPlaywrightProofStore {
  constructor(private readonly root: string) {}
  pathFor(taskId: string) {
    return path.join(this.root, 'runs', TaskIdSchema.parse(taskId), 'local', 'playwright.json');
  }
  artifactPath(taskId: string, operationId: string, kind: 'request' | 'response') {
    return path.join(
      this.root,
      'runs',
      TaskIdSchema.parse(taskId),
      'local',
      'playwright',
      Sha256Schema.parse(operationId),
      `${kind}.txt`,
    );
  }
  async read(taskId: string) {
    let raw: string;
    try {
      raw = await readFile(this.pathFor(taskId), 'utf8');
    } catch (error: any) {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    }
    const proof = PlaywrightProofSchema.parse(JSON.parse(raw));
    if (proof.taskId !== taskId)
      throw new ChatbridgeError('Playwright task mismatch', 'LOCAL_PLAYWRIGHT_PROOF_INVALID');
    new ConversationUrlPolicy(['https://chatgpt.com']).canonicalizeStable(proof.conversationUrl);
    if (
      sha256(
        await readFile(this.artifactPath(taskId, proof.operation.operationId, 'request'), 'utf8'),
      ) !== proof.operation.outboundSha256
    )
      throw new ChatbridgeError(
        'Playwright outbound proof mismatch',
        'LOCAL_PLAYWRIGHT_PROOF_INVALID',
      );
    if (proof.operation.state === 'RESPONDED') await this.response(proof);
    return proof;
  }
  async write(input: PlaywrightProof) {
    const proof = PlaywrightProofSchema.parse(input);
    const file = this.pathFor(proof.taskId);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(proof), { encoding: 'utf8', flag: 'wx' });
      await rename(temporary, file);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
  async artifact(
    taskId: string,
    operationId: string,
    kind: 'request' | 'response',
    content: string,
  ) {
    const file = this.artifactPath(taskId, operationId, kind);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
      await link(temporary, file);
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      if ((await readFile(file, 'utf8')) !== content)
        throw new ChatbridgeError(
          'Playwright artifact is immutable',
          'LOCAL_PLAYWRIGHT_ARTIFACT_IMMUTABLE',
        );
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
  async response(proof: PlaywrightProof) {
    const raw = await readFile(
      this.artifactPath(proof.taskId, proof.operation.operationId, 'response'),
      'utf8',
    );
    if (proof.operation.state !== 'RESPONDED' || sha256(raw) !== proof.operation.inboundSha256)
      throw new ChatbridgeError(
        'Playwright response proof mismatch',
        'LOCAL_PLAYWRIGHT_PROOF_INVALID',
      );
    return raw;
  }
}
