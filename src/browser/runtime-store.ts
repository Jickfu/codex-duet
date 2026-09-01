import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { RuntimeSelection } from './connection-types.js';

const RuntimeSchema = z.object({
  mode: z.enum(['existing-cdp', 'managed-installed', 'bundled']),
  browser: z.enum(['chrome', 'msedge', 'bundled']),
  endpoint: z.string().url(),
  attachedAt: z.string().datetime(),
});
export class RuntimeStore {
  private file: string;
  constructor(root: string) {
    this.file = path.join(root, 'runtime.json');
  }
  async read(): Promise<RuntimeSelection | undefined> {
    try {
      return RuntimeSchema.parse(JSON.parse(await readFile(this.file, 'utf8')));
    } catch (e: any) {
      if (e?.code === 'ENOENT') return undefined;
      throw e;
    }
  }
  async write(value: RuntimeSelection) {
    const parsed = RuntimeSchema.parse(value);
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(parsed, null, 2));
    await rename(tmp, this.file);
  }
}
