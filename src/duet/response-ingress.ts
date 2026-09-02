import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { TaskIdSchema } from '../core/domain.js';
import { ChatbridgeError } from '../core/errors.js';
import { canonicalJson } from './task-spec.js';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const ResponseIngressRecordV1Schema = z
  .object({
    version: z.literal(1),
    taskId: TaskIdSchema,
    iteration: z.number().int().positive(),
    controlSha256: Sha256Schema,
    responseSha256: Sha256Schema,
    source: z.enum(['BROWSER', 'MCP']),
    status: z.enum(['PENDING', 'ACCEPTED']),
    createdAt: z.string().datetime(),
    acceptedAt: z.string().datetime().optional(),
  })
  .strict();
export type ResponseIngressRecordV1 = z.infer<typeof ResponseIngressRecordV1Schema>;

export type ResponseIngressRequest = {
  taskId: string;
  iteration: number;
  controlSha256: string;
  response: string;
  source: 'BROWSER' | 'MCP';
};

/** The one authority used by Browser and MCP response transports. */
export class ResponseIngressService {
  private readonly active = new Set<string>();

  constructor(
    private readonly stateRoot: string,
    private readonly acceptResponse: (request: ResponseIngressRequest) => Promise<void>,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async accept(
    input: ResponseIngressRequest,
  ): Promise<{ disposition: 'ACCEPTED' | 'REPLAY'; record: ResponseIngressRecordV1 }> {
    const request = this.parse(input);
    const key = `${request.taskId}:${request.iteration}:${request.controlSha256}`;
    if (this.active.has(key))
      throw new ChatbridgeError('Response ingress is already active', 'RESPONSE_INGRESS_BUSY');
    this.active.add(key);
    try {
      const responseSha256 = sha256(request.response);
      let existing = await this.read(request);
      if (existing) {
        if (existing.responseSha256 !== responseSha256)
          throw new ChatbridgeError(
            'A different response was already accepted for this control message',
            'RESPONSE_ALREADY_ACCEPTED',
          );
        if (existing.status === 'ACCEPTED') return { disposition: 'REPLAY', record: existing };
      } else {
        const pending = ResponseIngressRecordV1Schema.parse({
          version: 1,
          taskId: request.taskId,
          iteration: request.iteration,
          controlSha256: request.controlSha256,
          responseSha256,
          source: request.source,
          status: 'PENDING',
          createdAt: this.now(),
        });
        existing = await this.createPending(pending);
        if (existing.responseSha256 !== responseSha256)
          throw new ChatbridgeError(
            'A different response was already accepted for this control message',
            'RESPONSE_ALREADY_ACCEPTED',
          );
        if (existing.status === 'ACCEPTED') return { disposition: 'REPLAY', record: existing };
      }
      await this.acceptResponse(request);
      const record = ResponseIngressRecordV1Schema.parse({
        ...existing,
        status: 'ACCEPTED',
        acceptedAt: this.now(),
      });
      await this.write(record);
      return { disposition: 'ACCEPTED', record };
    } finally {
      this.active.delete(key);
    }
  }

  async status(input: Pick<ResponseIngressRequest, 'taskId' | 'iteration' | 'controlSha256'>) {
    const parsed = z
      .object({
        taskId: TaskIdSchema,
        iteration: z.number().int().positive(),
        controlSha256: Sha256Schema,
      })
      .strict()
      .parse(input);
    return this.read(parsed);
  }

  private parse(input: ResponseIngressRequest): ResponseIngressRequest {
    return z
      .object({
        taskId: TaskIdSchema,
        iteration: z.number().int().positive(),
        controlSha256: Sha256Schema,
        response: z
          .string()
          .min(1)
          .max(64 * 1024),
        source: z.enum(['BROWSER', 'MCP']),
      })
      .strict()
      .parse(input);
  }

  private async read(input: {
    taskId: string;
    iteration: number;
    controlSha256: string;
  }): Promise<ResponseIngressRecordV1 | undefined> {
    try {
      return ResponseIngressRecordV1Schema.parse(
        JSON.parse(await readFile(this.file(input), 'utf8')),
      );
    } catch (error: any) {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private async write(record: ResponseIngressRecordV1): Promise<void> {
    const parsed = ResponseIngressRecordV1Schema.parse(record);
    const file = this.file(parsed);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${canonicalJson(parsed)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, file);
  }

  private async createPending(record: ResponseIngressRecordV1): Promise<ResponseIngressRecordV1> {
    const file = this.file(record);
    await mkdir(path.dirname(file), { recursive: true });
    try {
      await writeFile(file, `${canonicalJson(record)}\n`, { encoding: 'utf8', flag: 'wx' });
      return record;
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      return ResponseIngressRecordV1Schema.parse(JSON.parse(await readFile(file, 'utf8')));
    }
  }

  private file(input: { taskId: string; iteration: number; controlSha256: string }): string {
    return path.join(
      this.stateRoot,
      'runs',
      input.taskId,
      'ingress',
      String(input.iteration),
      `${input.controlSha256}.json`,
    );
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
