import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson } from '../duet/task-spec.js';
import { ChatbridgeError } from '../core/errors.js';

export async function createImmutableJson(
  file: string,
  value: unknown,
  verifyExisting = true,
): Promise<void> {
  const content = `${canonicalJson(value)}\n`;
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await link(temporary, file);
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
    if (verifyExisting && (await readFile(file, 'utf8')) !== content)
      throw new ChatbridgeError('Immutable local evidence diverged', 'LOCAL_EVIDENCE_IMMUTABLE');
  } finally {
    await unlink(temporary).catch((error: any) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
}
