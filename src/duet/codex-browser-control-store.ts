import { link, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ChatbridgeError } from '../core/errors.js';
import { TaskIdSchema } from '../core/domain.js';
import { TaskOperationLock } from './task-operation-lock.js';
import { canonicalJson } from './task-spec.js';
import { CodexBrowserHandoffSchema, type CodexBrowserHandoff } from './codex-browser-handoff.js';
import {
  CodexBrowserControlV1Schema,
  type CodexBrowserControlV1,
} from './codex-browser-control.js';

export class CodexBrowserControlStore {
  constructor(private readonly stateRoot: string) {}

  async withOperationLock<T>(taskId: string, action: () => Promise<T>): Promise<T> {
    return new TaskOperationLock(this.stateRoot).withLock(taskId, async () => {
      const current = await this.read(taskId);
      if (current) {
        const handoff = await this.readHandoff(taskId, current.operation.operationId);
        if (handoff && current.conversationUrl !== handoff.after.conversationUrl)
          throw new ChatbridgeError(
            'Recover the recorded handoff before sending',
            'LOCAL_HANDOFF_PENDING',
          );
      }
      return action();
    });
  }

  async readHandoff(taskId: string, operationId: string): Promise<CodexBrowserHandoff | undefined> {
    try {
      const record = CodexBrowserHandoffSchema.parse(
        JSON.parse(await readFile(this.handoffPath(taskId, operationId), 'utf8')),
      );
      if (record.before.taskId !== taskId || record.before.operation.operationId !== operationId)
        throw new ChatbridgeError('Handoff path identity mismatch', 'LOCAL_HANDOFF_INVALID');
      return record;
    } catch (error: any) {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async createHandoff(input: CodexBrowserHandoff): Promise<void> {
    const record = CodexBrowserHandoffSchema.parse(input);
    const file = this.handoffPath(record.before.taskId, record.before.operation.operationId);
    const content = canonicalJson(record) + '\n';
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
      await link(temporary, file);
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      if ((await readFile(file, 'utf8')) !== content)
        throw new ChatbridgeError('Handoff is immutable', 'LOCAL_HANDOFF_IMMUTABLE');
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  private handoffPath(taskId: string, operationId: string) {
    if (!/^[a-f0-9]{64}$/.test(operationId))
      throw new ChatbridgeError('Invalid operation', 'LOCAL_HANDOFF_INVALID');
    return path.join(
      this.stateRoot,
      'runs',
      this.taskId(taskId),
      'codex-browser-handoffs',
      `${operationId}.json`,
    );
  }

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
      // Keep previous conversations reserved; migration never frees historical evidence for reuse.
      let history: string[] = [];
      try {
        history = await readdir(path.join(runs, entry.name, 'codex-browser-handoffs'));
      } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error;
      }
      for (const name of history.filter((name) => name.endsWith('.json'))) {
        const record = await this.readHandoff(entry.name, name.slice(0, -5));
        if (record) result.push(record.before, record.after);
      }
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
