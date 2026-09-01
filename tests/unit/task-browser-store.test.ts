import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConversationUrlPolicy } from '../../src/browser/conversation-url.js';
import {
  TaskBrowserBindingV1Schema,
  TaskBrowserStore,
} from '../../src/browser/task-browser-store.js';

const roots: string[] = [];
async function root() {
  const value = await mkdtemp(path.join(os.tmpdir(), 'task-browser-'));
  roots.push(value);
  return value;
}
function binding(taskId = 'task-a') {
  return {
    version: 1 as const,
    taskId,
    conversation: {
      url: `https://chatgpt.com/c/${taskId}`,
      boundAt: new Date(0).toISOString(),
    },
    pendingSend: {
      outgoingUserMessageId: `user_${taskId}`,
      previousAssistantMessageId: 'assistant_old',
      sentAt: new Date(1).toISOString(),
    },
  };
}

afterEach(async () =>
  Promise.all(roots.splice(0).map((item) => rm(item, { recursive: true, force: true }))),
);

describe('TaskBrowserStore', () => {
  it('strictly and atomically persists task-scoped browser identity', async () => {
    const stateRoot = await root();
    const store = new TaskBrowserStore(stateRoot);
    await store.write(binding());
    expect(await store.read('task-a')).toEqual(binding());
    expect(await readdir(path.dirname(store.pathFor('task-a')))).toEqual(['browser.json']);
    expect(await readFile(store.pathFor('task-a'), 'utf8')).not.toContain('prompt');
  });

  it('separates tasks and never lets A overwrite B', async () => {
    const store = new TaskBrowserStore(await root());
    await store.write(binding('task-a'));
    await store.write(binding('task-b'));
    expect((await store.read('task-a'))?.conversation.url).toContain('task-a');
    expect((await store.read('task-b'))?.conversation.url).toContain('task-b');
    expect(await store.list()).toHaveLength(2);
  });

  it('rejects malformed, unknown, content, path, and message-id fields', async () => {
    expect(() => TaskBrowserBindingV1Schema.parse({ ...binding(), unknown: true })).toThrow();
    expect(() =>
      TaskBrowserBindingV1Schema.parse({ ...binding(), prompt: 'must not persist' }),
    ).toThrow();
    expect(() =>
      TaskBrowserBindingV1Schema.parse({
        ...binding(),
        pendingSend: { ...binding().pendingSend, outgoingUserMessageId: 'bad id' },
      }),
    ).toThrow();
    const store = new TaskBrowserStore(await root());
    await expect(store.read('../escape')).rejects.toMatchObject({ code: 'INVALID_TASK_ID' });
    const file = store.pathFor('task-a');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '{"version":99}', 'utf8');
    await expect(store.read('task-a')).rejects.toThrow();
  });
});

describe('ConversationUrlPolicy', () => {
  const urls = new ConversationUrlPolicy(['https://chatgpt.com']);

  it('uses one canonical identity for equality and strips fragments', () => {
    expect(urls.canonicalize('HTTPS://CHATGPT.COM:443/c/test#fragment')).toBe(
      'https://chatgpt.com/c/test',
    );
  });

  it.each([
    'https://example.test/c/x',
    'https://user:password@chatgpt.com/c/x',
    'javascript:alert(1)',
    'file:///tmp/x',
    'not a url',
  ])('rejects unsafe conversation URL %s', (value) => {
    expect(() => urls.canonicalize(value)).toThrow();
  });
});
