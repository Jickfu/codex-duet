import { readFile } from 'node:fs/promises';
import { runtime } from './runtime.js';
export async function send(messageFile: string) {
  const message = await readFile(messageFile, 'utf8');
  const r = await runtime();
  try {
    if (!(await r.adapter.isLoggedIn()))
      throw new Error(
        'ChatGPT is not logged in. Run `chatbridge browser open`, log in manually, then retry.',
      );
    const marker = await r.adapter.sendMessage(message);
    await r.store.write({ version: 2, ...marker, sentAt: new Date().toISOString() });
    console.log('Message sent.');
  } finally {
    await r.connection.close();
  }
}
