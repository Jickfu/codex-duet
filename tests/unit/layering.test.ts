import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
describe('layering', () => {
  it('keeps DOM concerns out of protocol', async () => {
    const source = await readFile(new URL('../../src/core/protocol.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/playwright|Locator|document\./i);
  });

  it('keeps core task and protocol schemas independent of the GitHub implementation layer', async () => {
    const sources = await Promise.all(
      ['task.ts', 'protocol.ts', 'domain.ts'].map((file) =>
        readFile(new URL(`../../src/core/${file}`, import.meta.url), 'utf8'),
      ),
    );
    expect(sources.join('\n')).not.toMatch(/from ['"]\.\.\/github\//);
  });
});
