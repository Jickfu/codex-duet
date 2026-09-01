import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TaskIdSchema } from '../core/domain.js';
import { ChatbridgeError } from '../core/errors.js';
import { ExecutionCheckpointV1Schema, type ExecutionCheckpointV1 } from './execution-checkpoint.js';

export class ExecutionStore {
  constructor(private readonly stateRoot: string) {}

  async read(taskIdInput: string, iteration: number): Promise<ExecutionCheckpointV1 | undefined> {
    const file = this.checkpointPath(taskIdInput, iteration);
    try {
      return ExecutionCheckpointV1Schema.parse(JSON.parse(await readFile(file, 'utf8')));
    } catch (error: any) {
      if (error?.code === 'ENOENT') return undefined;
      if (error?.name === 'ZodError' || error instanceof SyntaxError)
        throw new ChatbridgeError(
          'Execution checkpoint is invalid',
          'EXECUTION_CHECKPOINT_INVALID',
        );
      throw error;
    }
  }

  async write(value: ExecutionCheckpointV1): Promise<void> {
    const checkpoint = ExecutionCheckpointV1Schema.parse(value);
    const file = this.checkpointPath(checkpoint.taskId, checkpoint.iteration);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, JSON.stringify(checkpoint, null, 2), 'utf8');
    await rename(temporary, file);
  }

  checkpointPath(taskIdInput: string, iteration: number): string {
    const parsed = TaskIdSchema.safeParse(taskIdInput);
    if (!parsed.success) throw new ChatbridgeError('Invalid task ID', 'INVALID_TASK_ID');
    if (!Number.isInteger(iteration) || iteration < 1)
      throw new ChatbridgeError('Invalid execution iteration', 'INVALID_ITERATION');
    return path.join(
      this.stateRoot,
      'runs',
      parsed.data,
      'iterations',
      String(iteration),
      'execution.json',
    );
  }
}
