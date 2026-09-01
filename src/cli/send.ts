import { readFile } from 'node:fs/promises';
import { runtime } from './runtime.js';
import { taskAwareSend } from './task-browser.js';
import { ChatbridgeError } from '../core/errors.js';

export async function send(messageFile: string, taskId?: string, conversationUrl?: string) {
  if (conversationUrl && !taskId)
    throw new ChatbridgeError(
      '--conversation-url requires a task-aware send with --task',
      'TASK_REQUIRED',
    );
  const message = await readFile(messageFile, 'utf8');
  if (taskId) {
    await taskAwareSend(message, taskId, conversationUrl);
    console.log('Message sent.');
    return;
  }
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
