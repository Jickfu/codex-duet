import { z } from 'zod';
import { ChatbridgeError } from '../core/errors.js';
import { TaskIdSchema, TestStatusSchema } from '../core/domain.js';
import { LOCAL_LIMITS } from './limits.js';
import { SnapshotIdSchema } from './domain.js';
import { validateWorkspaceRelativePath } from './path-policy.js';
import { isSensitiveWorkspacePath } from './sensitive-policy.js';
import { LocalSnapshotStore } from './snapshot-store.js';

const BoundRequestSchema = z
  .object({ taskId: TaskIdSchema, snapshotId: SnapshotIdSchema })
  .strict();
const MAX_BASE64_SOURCE_BYTES = Math.floor((LOCAL_LIMITS.readResponseBytes - 4096) * 0.75);

export const LocalTestEvidenceV1Schema = z
  .object({
    version: z.literal(1),
    taskId: TaskIdSchema,
    snapshotId: SnapshotIdSchema,
    status: TestStatusSchema,
    summary: z.string().max(LOCAL_LIMITS.readResponseBytes),
    recordedAt: z.string().datetime(),
  })
  .strict();
export type LocalTestEvidenceV1 = z.infer<typeof LocalTestEvidenceV1Schema>;

export const LocalExecutionSummaryV1Schema = z
  .object({
    version: z.literal(1),
    taskId: TaskIdSchema,
    snapshotId: SnapshotIdSchema,
    iteration: z.number().int().positive(),
    summary: z.string().max(LOCAL_LIMITS.readResponseBytes),
  })
  .strict();
export type LocalExecutionSummaryV1 = z.infer<typeof LocalExecutionSummaryV1Schema>;

export interface LocalEvidenceReader {
  readTestEvidence(taskId: string, snapshotId: string): Promise<unknown>;
  readExecutionSummary(taskId: string, snapshotId: string): Promise<unknown>;
}

export class LocalWorkspaceService {
  constructor(
    private readonly snapshots: LocalSnapshotStore,
    private readonly evidence?: LocalEvidenceReader,
  ) {}

  async workspaceInfo(request: { taskId: string; snapshotId: string }) {
    const { manifest } = await this.boundManifest(request);
    return { taskId: manifest.taskId, snapshot: manifest.snapshot };
  }

  async listDirectory(request: {
    taskId: string;
    snapshotId: string;
    path?: string | undefined;
    cursor?: string | undefined;
    limit?: number | undefined;
  }) {
    const { manifest } = await this.boundManifest(request);
    const directory = request.path ? validateWorkspaceRelativePath(request.path) : '';
    const prefix = directory ? `${directory}/` : '';
    const names = new Map<string, 'FILE' | 'DIRECTORY'>();
    for (const entry of manifest.entries) {
      if (!entry.path.startsWith(prefix)) continue;
      const remainder = entry.path.slice(prefix.length);
      if (!remainder) continue;
      const slash = remainder.indexOf('/');
      const name = slash < 0 ? remainder : remainder.slice(0, slash);
      const exposedPath = prefix + name;
      this.assertExposable(exposedPath);
      names.set(name, slash < 0 ? 'FILE' : 'DIRECTORY');
    }
    const sorted = [...names].sort(([a], [b]) => compareText(a, b));
    const start = request.cursor ? sorted.findIndex(([name]) => name > request.cursor!) : 0;
    const safeStart = start < 0 ? sorted.length : start;
    const limit = Math.min(
      Math.max(request.limit ?? LOCAL_LIMITS.directoryPageEntries, 1),
      LOCAL_LIMITS.directoryPageEntries,
    );
    const page = sorted.slice(safeStart, safeStart + limit);
    return {
      path: directory,
      entries: page.map(([name, kind]) => ({ name, kind })),
      nextCursor: safeStart + limit < sorted.length ? page.at(-1)?.[0] : undefined,
    };
  }

  async readFile(request: {
    taskId: string;
    snapshotId: string;
    path: string;
    offset?: number | undefined;
    length?: number | undefined;
  }) {
    const { manifest } = await this.boundManifest(request);
    const filePath = validateWorkspaceRelativePath(request.path);
    this.assertExposable(filePath);
    const entry = manifest.entries.find((candidate) => candidate.path === filePath);
    if (!entry) throw new ChatbridgeError('Snapshot file was not found', 'LOCAL_FILE_NOT_FOUND');
    const offset = z
      .number()
      .int()
      .nonnegative()
      .parse(request.offset ?? 0);
    const length = Math.min(
      z
        .number()
        .int()
        .positive()
        .parse(request.length ?? MAX_BASE64_SOURCE_BYTES),
      MAX_BASE64_SOURCE_BYTES,
    );
    const bytes = await this.snapshots.readBlob(entry.blobSha256);
    const slice = bytes.subarray(offset, Math.min(offset + length, bytes.length));
    return {
      path: filePath,
      offset,
      bytes: slice.length,
      totalBytes: bytes.length,
      encoding: 'base64' as const,
      content: slice.toString('base64'),
      truncated: offset + slice.length < bytes.length,
    };
  }

  async searchWorkspace(request: {
    taskId: string;
    snapshotId: string;
    query: string;
    path?: string | undefined;
    limit?: number | undefined;
  }) {
    const { manifest } = await this.boundManifest(request);
    const query = z.string().min(1).max(1024).parse(request.query);
    const root = request.path ? validateWorkspaceRelativePath(request.path) : '';
    const prefix = root ? `${root}/` : '';
    const limit = Math.min(
      Math.max(request.limit ?? LOCAL_LIMITS.searchResults, 1),
      LOCAL_LIMITS.searchResults,
    );
    const results: Array<{ path: string; line: number; text: string }> = [];
    let responseBytes = 0;
    for (const entry of manifest.entries) {
      if (root && entry.path !== root && !entry.path.startsWith(prefix)) continue;
      this.assertExposable(entry.path);
      const bytes = await this.snapshots.readBlob(entry.blobSha256);
      if (bytes.includes(0)) continue;
      const content = bytes.toString('utf8');
      if (!Buffer.from(content, 'utf8').equals(bytes)) continue;
      for (const [index, line] of content.split(/\r?\n/).entries()) {
        if (!line.includes(query)) continue;
        const available = LOCAL_LIMITS.readResponseBytes - responseBytes - 1024;
        if (available <= 0) return { results, truncated: true };
        const text = truncateUtf8(line, Math.min(4096, available));
        responseBytes += Buffer.byteLength(entry.path) + Buffer.byteLength(text) + 64;
        results.push({ path: entry.path, line: index + 1, text });
        if (results.length >= limit || responseBytes >= LOCAL_LIMITS.readResponseBytes - 1024)
          return { results, truncated: true };
      }
    }
    return { results, truncated: false };
  }

  async gitStatus(request: {
    taskId: string;
    snapshotId: string;
    offset?: number | undefined;
    length?: number | undefined;
  }) {
    const { manifest } = await this.boundManifest(request);
    return this.readArtifact(manifest.gitStatusBlobSha256, request, 'git status');
  }

  async gitDiff(request: {
    taskId: string;
    snapshotId: string;
    offset?: number | undefined;
    length?: number | undefined;
  }) {
    const { manifest } = await this.boundManifest(request);
    return this.readArtifact(manifest.gitDiffBlobSha256, request, 'git diff');
  }

  async testStatus(request: { taskId: string; snapshotId: string }): Promise<LocalTestEvidenceV1> {
    const bound = BoundRequestSchema.parse(request);
    if (!this.evidence)
      throw new ChatbridgeError('Test evidence is unavailable', 'LOCAL_EVIDENCE_UNAVAILABLE');
    const record = LocalTestEvidenceV1Schema.parse(
      await this.evidence.readTestEvidence(bound.taskId, bound.snapshotId),
    );
    this.assertEvidenceBinding(record, bound);
    this.assertBoundedText(record.summary, 'Test evidence');
    return record;
  }

  async executionSummary(request: {
    taskId: string;
    snapshotId: string;
  }): Promise<LocalExecutionSummaryV1> {
    const bound = BoundRequestSchema.parse(request);
    if (!this.evidence)
      throw new ChatbridgeError('Execution summary is unavailable', 'LOCAL_EVIDENCE_UNAVAILABLE');
    const record = LocalExecutionSummaryV1Schema.parse(
      await this.evidence.readExecutionSummary(bound.taskId, bound.snapshotId),
    );
    this.assertEvidenceBinding(record, bound);
    this.assertBoundedText(record.summary, 'Execution summary');
    return record;
  }

  private async boundManifest(request: { taskId: string; snapshotId: string }) {
    const bound = BoundRequestSchema.parse({
      taskId: request.taskId,
      snapshotId: request.snapshotId,
    });
    const manifest = await this.snapshots.read(bound.taskId, bound.snapshotId);
    for (const entry of manifest.entries) this.assertExposable(entry.path);
    return { bound, manifest };
  }

  private assertExposable(relativePath: string): void {
    if (isSensitiveWorkspacePath(relativePath))
      throw new ChatbridgeError(
        'Snapshot contains a sensitive path and is not reviewable',
        'LOCAL_SENSITIVE_PATH_UNREVIEWABLE',
      );
  }

  private async readArtifact(
    digest: string,
    request: { offset?: number | undefined; length?: number | undefined },
    label: string,
  ) {
    const bytes = await this.snapshots.readBlob(digest);
    if (bytes.length > LOCAL_LIMITS.materializedDiffBytes)
      throw new ChatbridgeError(
        `${label} exceeds the materialized limit`,
        'SNAPSHOT_LIMIT_EXCEEDED',
      );
    const offset = z
      .number()
      .int()
      .nonnegative()
      .parse(request.offset ?? 0);
    const length = Math.min(
      z
        .number()
        .int()
        .positive()
        .parse(request.length ?? MAX_BASE64_SOURCE_BYTES),
      MAX_BASE64_SOURCE_BYTES,
    );
    const slice = bytes.subarray(offset, Math.min(offset + length, bytes.length));
    return {
      encoding: 'base64' as const,
      content: slice.toString('base64'),
      offset,
      bytes: slice.length,
      totalBytes: bytes.length,
      truncated: offset + slice.length < bytes.length,
    };
  }

  private assertBoundedText(value: string, label: string): void {
    if (Buffer.byteLength(value) > LOCAL_LIMITS.readResponseBytes)
      throw new ChatbridgeError(`${label} exceeds the response limit`, 'SNAPSHOT_LIMIT_EXCEEDED');
  }

  private assertEvidenceBinding(
    record: { taskId: string; snapshotId: string },
    expected: { taskId: string; snapshotId: string },
  ): void {
    if (record.taskId !== expected.taskId || record.snapshotId !== expected.snapshotId)
      throw new ChatbridgeError(
        'Evidence does not match the requested snapshot',
        'LOCAL_EVIDENCE_IDENTITY_MISMATCH',
      );
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value);
  if (bytes.length <= maxBytes) return value;
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, maxBytes));
}
