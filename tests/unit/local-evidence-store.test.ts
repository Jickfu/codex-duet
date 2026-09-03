import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { LocalEvidenceStore } from '../../src/local/evidence-store.js';

describe('LOCAL evidence identity', () => {
  it.each([
    ['tests', 'taskId'],
    ['tests', 'iteration'],
    ['tests', 'snapshotId'],
    ['execution', 'taskId'],
    ['execution', 'iteration'],
    ['execution', 'snapshotId'],
  ])(
    'rejects foreign %s evidence with mismatched %s at a valid requested pathname',
    async (kind, field) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'local-evidence-'));
      const snapshotId = 'a'.repeat(64);
      const directory = path.join(root, 'runs', 'demo', 'local', 'evidence', '1', snapshotId);
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, `${kind}.json`),
        JSON.stringify({
          version: 1,
          taskId: 'demo',
          iteration: 1,
          snapshotId,
          summary: 'fixture',
          ...(kind === 'tests' ? { status: 'PASS', recordedAt: new Date(0).toISOString() } : {}),
          [field!]: field === 'taskId' ? 'foreign' : field === 'iteration' ? 2 : 'b'.repeat(64),
        }),
      );
      const store = new LocalEvidenceStore(root);
      await expect(
        kind === 'tests'
          ? store.readTestEvidence('demo', 1, snapshotId)
          : store.readExecutionSummary('demo', 1, snapshotId),
      ).rejects.toMatchObject({ code: 'LOCAL_EVIDENCE_IDENTITY_MISMATCH' });
    },
  );
});
