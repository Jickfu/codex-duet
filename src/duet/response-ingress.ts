import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { TaskIdSchema } from '../core/domain.js';
import { ChatbridgeError } from '../core/errors.js';
import { canonicalJson } from './task-spec.js';
import { TaskOperationLock } from './task-operation-lock.js';

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
  private readonly lock: TaskOperationLock;

  constructor(
    private readonly stateRoot: string,
    private readonly acceptResponse: (request: ResponseIngressRequest) => Promise<void>,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.lock = new TaskOperationLock(stateRoot);
  }

  async accept(
    input: ResponseIngressRequest,
  ): Promise<{ disposition: 'ACCEPTED' | 'REPLAY'; record: ResponseIngressRecordV1 }> {
    const request = this.parse(input);
    return this.lock.withLock(request.taskId, async () => {
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
    });
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

  async findByResponse(
    taskIdInput: string,
    response: string,
  ): Promise<ResponseIngressRecordV1 | undefined> {
    const taskId = TaskIdSchema.parse(taskIdInput);
    const root = path.join(this.stateRoot, 'runs', taskId, 'ingress');
    const matches: ResponseIngressRecordV1[] = [];
    let iterations;
    try {
      iterations = await readdir(root, { withFileTypes: true });
    } catch (error: any) {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    }
    for (const iteration of iterations) {
      if (!iteration.isDirectory() || !/^[1-9][0-9]*$/.test(iteration.name)) continue;
      for (const name of await readdir(path.join(root, iteration.name))) {
        if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
        const record = await this.read({
          taskId,
          iteration: Number(iteration.name),
          controlSha256: name.slice(0, -5),
        });
        if (record?.responseSha256 === sha256(response)) matches.push(record);
      }
    }
    if (matches.length > 1)
      throw new ChatbridgeError('Response matches multiple controls', 'RESPONSE_INGRESS_AMBIGUOUS');
    return matches[0];
  }

  private async read(input: {
    taskId: string;
    iteration: number;
    controlSha256: string;
  }): Promise<ResponseIngressRecordV1 | undefined> {
    try {
      const record = ResponseIngressRecordV1Schema.parse(
        JSON.parse(await readFile(this.file(input), 'utf8')),
      );
      if (
        record.taskId !== input.taskId ||
        record.iteration !== input.iteration ||
        record.controlSha256 !== input.controlSha256
      )
        throw new ChatbridgeError('Ingress path identity mismatch', 'RESPONSE_INGRESS_INVALID');
      return record;
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
    try {
      await writeFile(temporary, `${canonicalJson(parsed)}\n`, { encoding: 'utf8', flag: 'wx' });
      await rename(temporary, file);
    } finally {
      await unlink(temporary).catch((error: any) => {
        if (error?.code !== 'ENOENT') throw error;
      });
    }
  }

  private async createPending(record: ResponseIngressRecordV1): Promise<ResponseIngressRecordV1> {
    const file = this.file(record);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${canonicalJson(record)}\n`, { encoding: 'utf8', flag: 'wx' });
      await link(temporary, file);
      return record;
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      return ResponseIngressRecordV1Schema.parse(JSON.parse(await readFile(file, 'utf8')));
    } finally {
      await unlink(temporary).catch((error: any) => {
        if (error?.code !== 'ENOENT') throw error;
      });
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
