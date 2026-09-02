import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ChatbridgeError } from '../core/errors.js';
import { TaskIdSchema } from '../core/domain.js';
import {
  CodexBrowserControlV1Schema,
  type CodexBrowserControlV1,
} from './codex-browser-control.js';

export class CodexBrowserControlStore {
  constructor(private readonly stateRoot: string) {}

  async read(taskIdInput: string): Promise<CodexBrowserControlV1 | undefined> {
    const taskId = this.taskId(taskIdInput);
    try {
      const value = CodexBrowserControlV1Schema.parse(
        JSON.parse(await readFile(this.pathFor(taskId), 'utf8')),
      );
      if (value.taskId !== taskId)
        throw new ChatbridgeError(
          'Codex Browser checkpoint task ID does not match its path',
          'CODEX_BROWSER_TASK_MISMATCH',
        );
      return value;
    } catch (error: any) {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async write(value: CodexBrowserControlV1): Promise<void> {
    const checkpoint = CodexBrowserControlV1Schema.parse(value);
    const file = this.pathFor(checkpoint.taskId);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, JSON.stringify(checkpoint, null, 2), 'utf8');
    await rename(temporary, file);
  }

  pathFor(taskIdInput: string): string {
    return path.join(this.stateRoot, 'runs', this.taskId(taskIdInput), 'codex-browser.json');
  }

  private taskId(input: string): string {
    const parsed = TaskIdSchema.safeParse(input);
    if (!parsed.success)
      throw new ChatbridgeError('Invalid task ID for Codex Browser state path', 'INVALID_TASK_ID');
    return parsed.data;
  }
}
