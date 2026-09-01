import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ChatbridgeError } from '../core/errors.js';
import { TaskIdSchema } from '../core/domain.js';
import { DuetRunCheckpointV1Schema, type DuetRunCheckpointV1 } from './run.js';

export class DuetRunStore {
  constructor(private readonly stateRoot: string) {}

  async read(taskIdInput: string): Promise<DuetRunCheckpointV1 | undefined> {
    const taskId = this.taskId(taskIdInput);
    try {
      return DuetRunCheckpointV1Schema.parse(
        JSON.parse(await readFile(this.checkpointPath(taskId), 'utf8')),
      );
    } catch (error: any) {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async write(value: DuetRunCheckpointV1): Promise<void> {
    const checkpoint = DuetRunCheckpointV1Schema.parse(value);
    await this.atomicWrite(
      this.checkpointPath(checkpoint.taskId),
      JSON.stringify(checkpoint, null, 2),
    );
  }

  async writeArtifact(
    taskIdInput: string,
    name: 'request.md' | 'plan.md' | 'review-envelope.txt',
    content: string,
  ): Promise<void> {
    const taskId = this.taskId(taskIdInput);
    await this.atomicWrite(path.join(this.runDirectory(taskId), name), content);
  }

  artifactPath(
    taskIdInput: string,
    name: 'request.md' | 'plan.md' | 'review-envelope.txt',
  ): string {
    return path.join(this.runDirectory(this.taskId(taskIdInput)), name);
  }

  private checkpointPath(taskId: string): string {
    return path.join(this.stateRoot, 'runs', `${taskId}.json`);
  }

  private runDirectory(taskId: string): string {
    return path.join(this.stateRoot, 'runs', taskId);
  }

  private taskId(input: string): string {
    const parsed = TaskIdSchema.safeParse(input);
    if (!parsed.success)
      throw new ChatbridgeError('Invalid task ID for run path', 'INVALID_TASK_ID');
    return parsed.data;
  }

  private async atomicWrite(file: string, content: string): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, content, 'utf8');
    await rename(temporary, file);
  }
}
