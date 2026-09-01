import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
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

  it('keeps M3 orchestration outside Playwright and ChatGPT DOM internals', async () => {
    const directory = new URL('../../src/duet/', import.meta.url);
    const sources = await Promise.all(
      (await readdir(directory)).map((file) => readFile(new URL(file, directory), 'utf8')),
    );
    expect(sources.join('\n')).not.toMatch(
      /chatgpt-rules|playwright-cli-runner|Locator|document\.|querySelector/i,
    );
  });
});
