import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ResponseIngressService,
  type ResponseIngressRecordV1,
} from '../../src/duet/response-ingress.js';

describe('ResponseIngressService', () => {
  let root: string;
  const controlSha256 = createHash('sha256').update('control').digest('hex');

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'duet-ingress-'));
  });

  it('validates path identity on exclusive-publication collision', async () => {
    const ingress = new ResponseIngressService(root, async () => undefined);
    const expected: ResponseIngressRecordV1 = {
      version: 1,
      taskId: 'demo',
      iteration: 1,
      controlSha256,
      responseSha256: 'a'.repeat(64),
      source: 'MCP',
      status: 'PENDING',
      createdAt: '2026-09-03T00:00:00.000Z',
    };
    const directory = path.join(root, 'runs', 'demo', 'ingress', '1');
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, `${controlSha256}.json`),
      JSON.stringify({ ...expected, taskId: 'other' }),
    );
    const publication = ingress as unknown as {
      createPending(record: ResponseIngressRecordV1): Promise<ResponseIngressRecordV1>;
    };
    await expect(publication.createPending(expected)).rejects.toMatchObject({
      code: 'RESPONSE_INGRESS_INVALID',
    });
    expect(await readdir(directory)).toEqual([`${controlSha256}.json`]);
  });

  it('accepts once, makes exact replay idempotent, and rejects divergence', async () => {
    const apply = vi.fn(async () => undefined);
    const ingress = new ResponseIngressService(root, apply, () => '2026-09-03T00:00:00.000Z');
    const request = {
      taskId: 'demo',
      iteration: 1,
      controlSha256,
      response: 'first',
      source: 'BROWSER' as const,
    };
    await expect(ingress.accept(request)).resolves.toMatchObject({ disposition: 'ACCEPTED' });
    await expect(ingress.accept({ ...request, source: 'MCP' })).resolves.toMatchObject({
      disposition: 'REPLAY',
    });
    expect(apply).toHaveBeenCalledTimes(1);
    await expect(ingress.accept({ ...request, response: 'second' })).rejects.toMatchObject({
      code: 'RESPONSE_ALREADY_ACCEPTED',
    });
  });

  it('does not authorize a response rejected by lifecycle validation', async () => {
    const ingress = new ResponseIngressService(root, async () => {
      throw new Error('invalid');
    });
    await expect(
      ingress.accept({
        taskId: 'demo',
        iteration: 1,
        controlSha256,
        response: 'invalid',
        source: 'MCP',
      }),
    ).rejects.toThrow('invalid');
    await expect(
      ingress.status({ taskId: 'demo', iteration: 1, controlSha256 }),
    ).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('reconciles an exact pending response after a crash boundary', async () => {
    let attempts = 0;
    const ingress = new ResponseIngressService(root, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('crash');
    });
    const request = {
      taskId: 'demo',
      iteration: 1,
      controlSha256,
      response: 'same response',
      source: 'MCP' as const,
    };
    await expect(ingress.accept(request)).rejects.toThrow('crash');
    await expect(ingress.accept(request)).resolves.toMatchObject({ disposition: 'ACCEPTED' });
    expect(attempts).toBe(2);
  });

  it('serializes independent ingress instances before lifecycle application', async () => {
    const apply = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    const first = new ResponseIngressService(root, apply);
    const second = new ResponseIngressService(root, apply);
    const request = {
      taskId: 'demo',
      iteration: 1,
      controlSha256,
      response: 'same',
      source: 'BROWSER' as const,
    };
    const results = await Promise.all([
      first.accept(request),
      second.accept({ ...request, source: 'MCP' }),
    ]);
    expect(results.map((result) => result.disposition).sort()).toEqual(['ACCEPTED', 'REPLAY']);
    expect(apply).toHaveBeenCalledOnce();
  });
});
