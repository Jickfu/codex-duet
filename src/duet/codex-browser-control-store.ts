import { link, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
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

  async list(): Promise<CodexBrowserControlV1[]> {
    const runs = path.join(this.stateRoot, 'runs');
    let entries;
    try {
      entries = await readdir(runs, { withFileTypes: true });
    } catch (error: any) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    const result: CodexBrowserControlV1[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const value = await this.read(entry.name);
      if (value) result.push(value);
    }
    return result;
  }

  async createResponseArtifact(taskIdInput: string, operationId: string, content: string) {
    const file = path.join(
      this.stateRoot,
      'runs',
      this.taskId(taskIdInput),
      'codex-browser',
      operationId,
      'response.txt',
    );
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
      await link(temporary, file);
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      if ((await readFile(file, 'utf8')) !== content)
        throw new ChatbridgeError(
          'Codex Browser response artifact is immutable',
          'CODEX_BROWSER_RESPONSE_IMMUTABLE',
        );
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
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
