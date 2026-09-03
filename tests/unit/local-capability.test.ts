import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalMcpCapabilityStore } from '../../src/local/capability-store.js';

describe('LocalMcpCapabilityStore', () => {
  let root: string;
  const controlSha256 = createHash('sha256').update('control').digest('hex');

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'duet-capability-'));
  });

  it('issues a high-entropy secret but persists only its digest and exact binding', async () => {
    const store = new LocalMcpCapabilityStore(root, () => '2026-09-03T00:00:00.000Z');
    const issued = await store.issue({ taskId: 'demo', iteration: 2, controlSha256 });
    expect(issued.token.length).toBeGreaterThanOrEqual(43);
    const persisted = await readFile(
      path.join(root, 'mcp', 'capabilities', `${issued.capabilityId}.json`),
      'utf8',
    );
    expect(persisted).not.toContain(issued.token);
    await expect(
      store.authorize({
        capabilityId: issued.capabilityId,
        token: issued.token,
        taskId: 'demo',
        iteration: 2,
        controlSha256,
      }),
    ).resolves.toMatchObject({ taskId: 'demo', iteration: 2, controlSha256 });
  });

  it('fails closed for token or binding mismatch', async () => {
    const store = new LocalMcpCapabilityStore(root);
    const issued = await store.issue({ taskId: 'demo', iteration: 1, controlSha256 });
    await expect(
      store.authorize({
        capabilityId: issued.capabilityId,
        token: `${issued.token.slice(0, -1)}x`,
        taskId: 'demo',
        iteration: 1,
        controlSha256,
      }),
    ).rejects.toMatchObject({ code: 'MCP_CAPABILITY_INVALID' });
    await expect(
      store.authorize({
        capabilityId: issued.capabilityId,
        token: issued.token,
        taskId: 'other',
        iteration: 1,
        controlSha256,
      }),
    ).rejects.toMatchObject({ code: 'MCP_CAPABILITY_INVALID' });
  });
  it('rejects a valid record copied under another capability ID', async () => {
    const store = new LocalMcpCapabilityStore(root);
    const first = await store.issue({ taskId: 'demo', iteration: 1, controlSha256 });
    const second = await store.issue({ taskId: 'demo', iteration: 1, controlSha256 });
    const file = (id: string) => path.join(root, 'mcp', 'capabilities', id + '.json');
    await writeFile(file(second.capabilityId), await readFile(file(first.capabilityId)));
    await expect(
      store.authorize({
        capabilityId: second.capabilityId,
        token: first.token,
        taskId: 'demo',
        iteration: 1,
        controlSha256,
      }),
    ).rejects.toMatchObject({ code: 'MCP_CAPABILITY_INVALID' });
  });
});
