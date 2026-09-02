import { z } from 'zod';
import { ChatbridgeError } from '../core/errors.js';
import { TaskIdSchema, TestStatusSchema } from '../core/domain.js';
import { canonicalJson } from '../duet/task-spec.js';
import { LOCAL_LIMITS } from './limits.js';
import { SnapshotIdSchema } from './domain.js';
import { validateWorkspaceRelativePath } from './path-policy.js';
import { isSensitiveWorkspacePath } from './sensitive-policy.js';
import { LocalSnapshotStore } from './snapshot-store.js';

const BoundRequestSchema = z
  .object({ taskId: TaskIdSchema, snapshotId: SnapshotIdSchema })
  .strict();
const MAX_BASE64_SOURCE_BYTES = Math.floor((LOCAL_LIMITS.readResponseBytes - 4096) * 0.75);

export const LocalGitArtifactV1Schema = z
  .object({
    version: z.literal(1),
    kind: z.enum(['STATUS', 'DIFF']),
    paths: z.array(z.string().min(1)),
    contentBase64: z.string(),
  })
  .strict();
export type LocalGitArtifactV1 = z.infer<typeof LocalGitArtifactV1Schema>;

export function serializeLocalGitArtifact(artifact: LocalGitArtifactV1): Buffer {
  return Buffer.from(`${canonicalJson(LocalGitArtifactV1Schema.parse(artifact))}\n`);
}

export const LocalTestEvidenceV1Schema = z
  .object({
    version: z.literal(1),
    taskId: TaskIdSchema,
    snapshotId: SnapshotIdSchema,
    iteration: z.number().int().positive(),
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
  readTestEvidence(taskId: string, iteration: number, snapshotId: string): Promise<unknown>;
  readExecutionSummary(taskId: string, iteration: number, snapshotId: string): Promise<unknown>;
}

export class LocalWorkspaceService {
  constructor(
    private readonly snapshots: LocalSnapshotStore,
    private readonly evidence?: LocalEvidenceReader,
  ) {}

  async workspaceInfo(request: { taskId: string; snapshotId: string }) {
    const { manifest } = await this.boundManifest(request);
    return this.bounded({ taskId: manifest.taskId, snapshot: manifest.snapshot });
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
    return this.bounded({
      path: directory,
      entries: page.map(([name, kind]) => ({ name, kind })),
      nextCursor: safeStart + limit < sorted.length ? page.at(-1)?.[0] : undefined,
    });
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
    return this.bounded({
      path: filePath,
      offset,
      bytes: slice.length,
      totalBytes: bytes.length,
      encoding: 'base64' as const,
      content: slice.toString('base64'),
      truncated: offset + slice.length < bytes.length,
    });
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
    for (const entry of manifest.entries) {
      if (root && entry.path !== root && !entry.path.startsWith(prefix)) continue;
      this.assertExposable(entry.path);
      const bytes = await this.snapshots.readBlob(entry.blobSha256);
      if (bytes.includes(0)) continue;
      const content = bytes.toString('utf8');
      if (!Buffer.from(content, 'utf8').equals(bytes)) continue;
      for (const [index, line] of content.split(/\r?\n/).entries()) {
        if (!line.includes(query)) continue;
        const candidate = { path: entry.path, line: index + 1, text: truncateUtf8(line, 4096) };
        if (!this.fits({ results: [...results, candidate], truncated: true }))
          return this.bounded({ results, truncated: true });
        results.push(candidate);
        if (results.length >= limit) return this.bounded({ results, truncated: true });
      }
    }
    return this.bounded({ results, truncated: false });
  }

  async gitStatus(request: {
    taskId: string;
    snapshotId: string;
    offset?: number | undefined;
    length?: number | undefined;
  }) {
    const { statusArtifact } = await this.boundManifest(request);
    return this.readArtifact(statusArtifact, request);
  }

  async gitDiff(request: {
    taskId: string;
    snapshotId: string;
    offset?: number | undefined;
    length?: number | undefined;
  }) {
    const { diffArtifact } = await this.boundManifest(request);
    return this.readArtifact(diffArtifact, request);
  }

  async testStatus(request: {
    taskId: string;
    iteration: number;
    snapshotId: string;
  }): Promise<LocalTestEvidenceV1> {
    const bound = {
      ...BoundRequestSchema.parse({ taskId: request.taskId, snapshotId: request.snapshotId }),
      iteration: z.number().int().positive().parse(request.iteration),
    };
    await this.boundManifest(bound);
    if (!this.evidence)
      throw new ChatbridgeError('Test evidence is unavailable', 'LOCAL_EVIDENCE_UNAVAILABLE');
    const record = LocalTestEvidenceV1Schema.parse(
      await this.evidence.readTestEvidence(bound.taskId, bound.iteration, bound.snapshotId),
    );
    this.assertEvidenceBinding(record, bound);
    return this.bounded(record);
  }

  async executionSummary(request: {
    taskId: string;
    iteration: number;
    snapshotId: string;
  }): Promise<LocalExecutionSummaryV1> {
    const bound = {
      ...BoundRequestSchema.parse({ taskId: request.taskId, snapshotId: request.snapshotId }),
      iteration: z.number().int().positive().parse(request.iteration),
    };
    await this.boundManifest(bound);
    if (!this.evidence)
      throw new ChatbridgeError('Execution summary is unavailable', 'LOCAL_EVIDENCE_UNAVAILABLE');
    const record = LocalExecutionSummaryV1Schema.parse(
      await this.evidence.readExecutionSummary(bound.taskId, bound.iteration, bound.snapshotId),
    );
    this.assertEvidenceBinding(record, bound);
    return this.bounded(record);
  }

  private async boundManifest(request: { taskId: string; snapshotId: string }) {
    const bound = BoundRequestSchema.parse({
      taskId: request.taskId,
      snapshotId: request.snapshotId,
    });
    const manifest = await this.snapshots.read(bound.taskId, bound.snapshotId);
    for (const entry of manifest.entries) this.assertExposable(entry.path);
    const [statusArtifact, diffArtifact] = await Promise.all([
      this.validateArtifact(manifest.gitStatusBlobSha256, 'STATUS', 'git status'),
      this.validateArtifact(manifest.gitDiffBlobSha256, 'DIFF', 'git diff'),
    ]);
    return { bound, manifest, statusArtifact, diffArtifact };
  }

  private assertExposable(relativePath: string): void {
    if (isSensitiveWorkspacePath(relativePath))
      throw new ChatbridgeError(
        'Snapshot contains a sensitive path and is not reviewable',
        'LOCAL_SENSITIVE_PATH_UNREVIEWABLE',
      );
  }

  private async validateArtifact(digest: string, expectedKind: 'STATUS' | 'DIFF', label: string) {
    const stored = await this.snapshots.readBlob(digest);
    const artifact = LocalGitArtifactV1Schema.parse(JSON.parse(stored.toString('utf8')));
    if (artifact.kind !== expectedKind)
      throw new ChatbridgeError(
        `${label} artifact kind is invalid`,
        'LOCAL_MANIFEST_INTEGRITY_INVALID',
      );
    for (const artifactPath of artifact.paths) {
      validateWorkspaceRelativePath(artifactPath);
      this.assertExposable(artifactPath);
    }
    const bytes = Buffer.from(artifact.contentBase64, 'base64');
    if (bytes.toString('base64') !== artifact.contentBase64)
      throw new ChatbridgeError(
        `${label} artifact encoding is invalid`,
        'LOCAL_MANIFEST_INTEGRITY_INVALID',
      );
    if (bytes.length > LOCAL_LIMITS.materializedDiffBytes)
      throw new ChatbridgeError(
        `${label} exceeds the materialized limit`,
        'SNAPSHOT_LIMIT_EXCEEDED',
      );
    return { bytes };
  }

  private readArtifact(
    artifact: { bytes: Buffer },
    request: { offset?: number | undefined; length?: number | undefined },
  ) {
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
    const slice = artifact.bytes.subarray(offset, Math.min(offset + length, artifact.bytes.length));
    return this.bounded({
      encoding: 'base64' as const,
      content: slice.toString('base64'),
      offset,
      bytes: slice.length,
      totalBytes: artifact.bytes.length,
      truncated: offset + slice.length < artifact.bytes.length,
    });
  }

  private assertEvidenceBinding(
    record: { taskId: string; iteration: number; snapshotId: string },
    expected: { taskId: string; iteration: number; snapshotId: string },
  ): void {
    if (
      record.taskId !== expected.taskId ||
      record.iteration !== expected.iteration ||
      record.snapshotId !== expected.snapshotId
    )
      throw new ChatbridgeError(
        'Evidence does not match the requested snapshot',
        'LOCAL_EVIDENCE_IDENTITY_MISMATCH',
      );
  }

  private fits(value: unknown): boolean {
    return Buffer.byteLength(canonicalJson(value)) <= LOCAL_LIMITS.readResponseBytes;
  }

  private bounded<T>(value: T): T {
    if (!this.fits(value))
      throw new ChatbridgeError(
        'Serialized tool response exceeds the limit',
        'SNAPSHOT_LIMIT_EXCEEDED',
      );
    return value;
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
