import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ChatbridgeError } from '../core/errors.js';
import { TaskIdSchema } from '../core/domain.js';
import {
  serializeTaskSpec,
  TaskSpecV1Schema,
  validateTaskSpecIntegrity,
  type TaskSpecV1,
} from './task-spec.js';

export class TaskSpecStore {
  constructor(private readonly stateRoot: string) {}

  async read(taskIdInput: string): Promise<TaskSpecV1 | undefined> {
    const file = this.pathFor(taskIdInput);
    try {
      return validateTaskSpecIntegrity(
        TaskSpecV1Schema.parse(JSON.parse(await readFile(file, 'utf8'))),
      );
    } catch (error: any) {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async create(value: TaskSpecV1): Promise<void> {
    const spec = TaskSpecV1Schema.parse(value);
    const file = this.pathFor(spec.taskId);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, serializeTaskSpec(spec), { encoding: 'utf8', flag: 'wx' });
      await link(temporary, file);
    } catch (error: any) {
      if (error?.code === 'EEXIST')
        throw new ChatbridgeError(
          'TaskSpec already exists and Phase 1 does not support amendments',
          'TASK_SPEC_IMMUTABLE',
        );
      throw error;
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  pathFor(taskIdInput: string): string {
    const parsed = TaskIdSchema.safeParse(taskIdInput);
    if (!parsed.success)
      throw new ChatbridgeError('Invalid task ID for TaskSpec path', 'INVALID_TASK_ID');
    return path.join(this.stateRoot, 'runs', parsed.data, 'task-spec.json');
  }
}
