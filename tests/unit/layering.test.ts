import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
describe('layering', () => {
  it('keeps DOM concerns out of protocol', async () => {
    const source = await readFile(new URL('../../src/core/protocol.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/playwright|Locator|document\./i);
  });
});
