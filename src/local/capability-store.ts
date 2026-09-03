import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { TaskIdSchema } from '../core/domain.js';
import { ChatbridgeError } from '../core/errors.js';
import { canonicalJson } from '../duet/task-spec.js';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const CapabilityRecordV1Schema = z
  .object({
    version: z.literal(1),
    capabilityId: z.string().uuid(),
    tokenSha256: Sha256Schema,
    taskId: TaskIdSchema,
    iteration: z.number().int().positive(),
    controlSha256: Sha256Schema,
    createdAt: z.string().datetime(),
  })
  .strict();
export type LocalSubmitCapabilityV1 = z.infer<typeof CapabilityRecordV1Schema>;

export class LocalMcpCapabilityStore {
  constructor(
    private readonly stateRoot: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async issue(input: { taskId: string; iteration: number; controlSha256: string }) {
    const bound = z
      .object({
        taskId: TaskIdSchema,
        iteration: z.number().int().positive(),
        controlSha256: Sha256Schema,
      })
      .strict()
      .parse(input);
    const token = randomBytes(32).toString('base64url');
    const record = CapabilityRecordV1Schema.parse({
      version: 1,
      capabilityId: randomUUID(),
      tokenSha256: sha256(token),
      ...bound,
      createdAt: this.now(),
    });
    await this.atomicWrite(this.file(record.capabilityId), `${canonicalJson(record)}\n`);
    return { capabilityId: record.capabilityId, token };
  }

  async authorize(input: {
    capabilityId: string;
    token: string;
    taskId: string;
    iteration: number;
    controlSha256: string;
  }): Promise<LocalSubmitCapabilityV1> {
    const request = z
      .object({
        capabilityId: z.string().uuid(),
        token: z.string().min(43).max(128),
        taskId: TaskIdSchema,
        iteration: z.number().int().positive(),
        controlSha256: Sha256Schema,
      })
      .strict()
      .parse(input);
    let record: LocalSubmitCapabilityV1;
    try {
      record = CapabilityRecordV1Schema.parse(
        JSON.parse(await readFile(this.file(request.capabilityId), 'utf8')),
      );
    } catch (error: any) {
      if (error?.code === 'ENOENT')
        throw new ChatbridgeError('MCP capability is invalid', 'MCP_CAPABILITY_INVALID');
      throw error;
    }
    const expected = Buffer.from(record.tokenSha256, 'hex');
    const actual = Buffer.from(sha256(request.token), 'hex');
    if (
      !timingSafeEqual(expected, actual) ||
      record.capabilityId !== request.capabilityId ||
      record.taskId !== request.taskId ||
      record.iteration !== request.iteration ||
      record.controlSha256 !== request.controlSha256
    )
      throw new ChatbridgeError('MCP capability is invalid', 'MCP_CAPABILITY_INVALID');
    return record;
  }

  private file(capabilityId: string): string {
    return path.join(this.stateRoot, 'mcp', 'capabilities', `${capabilityId}.json`);
  }

  private async atomicWrite(file: string, content: string): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
