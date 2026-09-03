import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { TaskIdSchema } from '../core/domain.js';
import { ChatbridgeError } from '../core/errors.js';
import { Sha256Schema } from './domain.js';
import {
  LocalExecutionSummaryV1Schema,
  LocalTestEvidenceV1Schema,
  type LocalTestEvidenceV1,
  type LocalExecutionSummaryV1,
  type LocalEvidenceReader,
} from './workspace-service.js';
import type { LocalSnapshotAuthority } from './local-code-provider.js';
import { createImmutableJson } from './immutable-json.js';

export class LocalEvidenceStore implements LocalEvidenceReader {
  constructor(private readonly stateRoot: string) {}

  async record(
    tests: LocalTestEvidenceV1,
    execution: LocalExecutionSummaryV1,
    snapshots: LocalSnapshotAuthority,
  ): Promise<void> {
    const test = LocalTestEvidenceV1Schema.parse(tests);
    const summary = LocalExecutionSummaryV1Schema.parse(execution);
    if (
      test.taskId !== summary.taskId ||
      test.iteration !== summary.iteration ||
      test.snapshotId !== summary.snapshotId
    )
      throw new ChatbridgeError(
        'LOCAL evidence identity mismatch',
        'LOCAL_EVIDENCE_IDENTITY_MISMATCH',
      );
    // Caller runs tests; this guard can only attest that the bound candidate remains live.
    await snapshots.assertLiveSnapshot(test.snapshotId);
    await createImmutableJson(
      this.file(test.taskId, test.iteration, test.snapshotId, 'tests'),
      test,
    );
    await createImmutableJson(
      this.file(test.taskId, test.iteration, test.snapshotId, 'execution'),
      summary,
    );
  }

  async readTestEvidence(taskId: string, iteration: number, snapshotId: string) {
    const record = LocalTestEvidenceV1Schema.parse(
      JSON.parse(await readFile(this.file(taskId, iteration, snapshotId, 'tests'), 'utf8')),
    );
    this.assertIdentity(record, taskId, iteration, snapshotId);
    return record;
  }
  async readExecutionSummary(taskId: string, iteration: number, snapshotId: string) {
    const record = LocalExecutionSummaryV1Schema.parse(
      JSON.parse(await readFile(this.file(taskId, iteration, snapshotId, 'execution'), 'utf8')),
    );
    this.assertIdentity(record, taskId, iteration, snapshotId);
    return record;
  }
  private assertIdentity(
    record: { taskId: string; iteration: number; snapshotId: string },
    taskId: string,
    iteration: number,
    snapshotId: string,
  ) {
    if (
      record.taskId !== taskId ||
      record.iteration !== iteration ||
      record.snapshotId !== snapshotId
    )
      throw new ChatbridgeError(
        'LOCAL evidence identity mismatch',
        'LOCAL_EVIDENCE_IDENTITY_MISMATCH',
      );
  }
  private file(taskId: string, iteration: number, snapshotId: string, kind: 'tests' | 'execution') {
    return path.join(
      this.stateRoot,
      'runs',
      TaskIdSchema.parse(taskId),
      'local',
      'evidence',
      String(z.number().int().positive().parse(iteration)),
      Sha256Schema.parse(snapshotId),
      `${kind}.json`,
    );
  }
}
