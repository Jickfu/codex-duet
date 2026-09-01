import { parseEnvelope } from '../core/protocol.js';
import { runtime } from './runtime.js';
export async function wait(parse: boolean, timeout?: number) {
  const r = await runtime();
  try {
    const session = await r.store.read();
    if (!session) throw new Error('No pending send checkpoint. Run `chatbridge send` first.');
    const text = await r.adapter.waitForAssistantMessage({
      afterCount: session.assistantCount,
      ...(timeout ? { timeoutMs: timeout } : {}),
    });
    if (parse) console.log(JSON.stringify(parseEnvelope(text), null, 2));
    else console.log(text);
  } finally {
    await r.connection.close();
  }
}
