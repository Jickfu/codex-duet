import { link, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ChatbridgeError } from '../core/errors.js';
import { TaskIdSchema } from '../core/domain.js';
import { canonicalJson } from './task-spec.js';
import {
  DiscussionControlV1Schema,
  DiscussionResponseV1Schema,
  DiscussionSummaryV1Schema,
  type DiscussionControlV1,
  type DiscussionResponseV1,
  type DiscussionSummaryV1,
} from './discussion.js';

export class DiscussionStore {
  constructor(
    private readonly stateRoot: string,
    private readonly segment?: 'local-supplement',
  ) {}

  async readSummary(taskIdInput: string): Promise<DiscussionSummaryV1 | undefined> {
    const taskId = this.taskId(taskIdInput);
    try {
      const value = DiscussionSummaryV1Schema.parse(
        JSON.parse(await readFile(this.summaryPath(taskId), 'utf8')),
      );
      if (value.taskId !== taskId)
        throw new ChatbridgeError(
          'Discussion summary task ID does not match its path',
          'DISCUSSION_TASK_MISMATCH',
        );
      return value;
    } catch (error: any) {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async writeSummary(summary: DiscussionSummaryV1): Promise<void> {
    const parsed = DiscussionSummaryV1Schema.parse(summary);
    const file = this.summaryPath(parsed.taskId);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${canonicalJson(parsed)}\n`, 'utf8');
    await rename(temporary, file);
  }

  async createControl(control: DiscussionControlV1): Promise<void> {
    const parsed = DiscussionControlV1Schema.parse(control);
    await this.createOrVerify(
      this.roundPath(parsed.taskId, parsed.round, 'request.json'),
      `${canonicalJson(parsed)}\n`,
    );
  }

  async readControl(taskId: string, round: number): Promise<DiscussionControlV1> {
    return DiscussionControlV1Schema.parse(
      JSON.parse(await readFile(this.roundPath(taskId, round, 'request.json'), 'utf8')),
    );
  }

  async createResponse(response: DiscussionResponseV1): Promise<void> {
    const parsed = DiscussionResponseV1Schema.parse(response);
    await this.createOrVerify(
      this.roundPath(parsed.taskId, parsed.round, 'response.json'),
      `${canonicalJson(parsed)}\n`,
    );
  }

  private async createOrVerify(file: string, content: string): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
      await link(temporary, file);
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      if ((await readFile(file, 'utf8')) !== content)
        throw new ChatbridgeError(
          'Discussion artifact already exists with different content',
          'DISCUSSION_ARTIFACT_IMMUTABLE',
        );
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  private summaryPath(taskId: string): string {
    return path.join(
      this.stateRoot,
      'runs',
      taskId,
      'discussion',
      this.segment ?? '',
      'summary.json',
    );
  }

  private roundPath(taskIdInput: string, round: number, name: string): string {
    if (!Number.isInteger(round) || round < 1 || round > 3)
      throw new ChatbridgeError('Invalid discussion round', 'DISCUSSION_ROUND_INVALID');
    return path.join(
      this.stateRoot,
      'runs',
      this.taskId(taskIdInput),
      'discussion',
      this.segment ?? '',
      `round-${round}`,
      name,
    );
  }

  private taskId(input: string): string {
    const parsed = TaskIdSchema.safeParse(input);
    if (!parsed.success)
      throw new ChatbridgeError('Invalid task ID for discussion path', 'INVALID_TASK_ID');
    return parsed.data;
  }
}
