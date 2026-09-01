import { parseEnvelope } from '../core/protocol.js';
import { runtime } from './runtime.js';
import { taskAwareWait } from './task-browser.js';

export async function wait(parse: boolean, timeout?: number, taskId?: string) {
  if (taskId) {
    const text = await taskAwareWait(taskId, timeout);
    if (parse) console.log(JSON.stringify(parseEnvelope(text), null, 2));
    else console.log(text);
    return;
  }
  const r = await runtime();
  try {
    const session = await r.store.read();
    if (!session) throw new Error('No pending send checkpoint. Run `chatbridge send` first.');
    const text = await r.adapter.waitForAssistantMessage({
      checkpoint: {
        conversationUrl: session.conversationUrl,
        outgoingUserMessageId: session.outgoingUserMessageId,
        ...(session.previousAssistantMessageId
          ? { previousAssistantMessageId: session.previousAssistantMessageId }
          : {}),
      },
      ...(timeout ? { timeoutMs: timeout } : {}),
    });
    if (parse) console.log(JSON.stringify(parseEnvelope(text), null, 2));
    else console.log(text);
  } finally {
    await r.connection.close();
  }
}
