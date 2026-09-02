import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ChatbridgeError } from '../core/errors.js';
import { canonicalJson, sha256 } from '../duet/task-spec.js';
import { TaskIdSchema } from '../core/domain.js';
import {
  LocalWorkspaceSnapshotV1Schema,
  Sha256Schema,
  validateLocalWorkspaceSnapshotIntegrity,
} from './domain.js';

const SnapshotEntrySchema = z
  .object({
    path: z.string().min(1),
    blobSha256: Sha256Schema,
    bytes: z.number().int().nonnegative(),
  })
  .strict();

export const LocalSnapshotManifestV1Schema = z
  .object({
    version: z.literal(1),
    taskId: TaskIdSchema,
    purpose: z.enum(['BASELINE', 'REVIEW']),
    snapshot: LocalWorkspaceSnapshotV1Schema,
    entries: z.array(SnapshotEntrySchema),
    gitStatusBlobSha256: Sha256Schema,
    gitDiffBlobSha256: Sha256Schema,
  })
  .strict();
export type LocalSnapshotManifestV1 = z.infer<typeof LocalSnapshotManifestV1Schema>;

export function localSnapshotSurfaceManifestFingerprint(
  entries: LocalSnapshotManifestV1['entries'],
): string {
  return sha256(canonicalJson(entries));
}

export class LocalSnapshotStore {
  constructor(private readonly stateRoot: string) {}

  async putBlob(bytes: Buffer): Promise<string> {
    const digest = hashBytes(bytes);
    const file = this.blobPath(digest);
    await mkdir(path.dirname(file), { recursive: true });
    try {
      await writeFile(file, bytes, { flag: 'wx' });
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = await readFile(file);
      if (!existing.equals(bytes))
        throw new ChatbridgeError('Content-addressed blob collision', 'LOCAL_BLOB_COLLISION');
    }
    return digest;
  }

  async publish(manifest: LocalSnapshotManifestV1): Promise<void> {
    const parsed = LocalSnapshotManifestV1Schema.parse(manifest);
    validateLocalWorkspaceSnapshotIntegrity(parsed.snapshot);
    const canonicalEntries = [...parsed.entries].sort((a, b) => a.path.localeCompare(b.path));
    if (canonicalJson(canonicalEntries) !== canonicalJson(parsed.entries))
      throw new ChatbridgeError(
        'Snapshot entries are not canonically sorted',
        'LOCAL_MANIFEST_INVALID',
      );
    if (
      parsed.snapshot.surface.manifestSha256 !==
      localSnapshotSurfaceManifestFingerprint(parsed.entries)
    )
      throw new ChatbridgeError(
        'Snapshot surface manifest fingerprint is invalid',
        'LOCAL_MANIFEST_INTEGRITY_INVALID',
      );
    if (
      parsed.snapshot.artifacts.gitStatusSha256 !== parsed.gitStatusBlobSha256 ||
      parsed.snapshot.artifacts.gitDiffSha256 !== parsed.gitDiffBlobSha256
    )
      throw new ChatbridgeError(
        'Snapshot artifact fingerprint is invalid',
        'LOCAL_MANIFEST_INTEGRITY_INVALID',
      );
    for (const entry of parsed.entries) await this.assertBlob(entry.blobSha256, entry.bytes);
    await this.assertBlob(parsed.gitStatusBlobSha256);
    await this.assertBlob(parsed.gitDiffBlobSha256);
    const file = this.snapshotPath(parsed.taskId, parsed.snapshot.snapshotId);
    await mkdir(path.dirname(file), { recursive: true });
    const serialized = `${canonicalJson(parsed)}\n`;
    try {
      await writeFile(file, serialized, { flag: 'wx' });
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      if ((await readFile(file, 'utf8')) !== serialized)
        throw new ChatbridgeError(
          'Snapshot identity already has different bytes',
          'LOCAL_SNAPSHOT_IMMUTABLE',
        );
    }
  }

  async read(taskId: string, snapshotId: string): Promise<LocalSnapshotManifestV1> {
    const parsed = LocalSnapshotManifestV1Schema.parse(
      JSON.parse(
        await readFile(
          this.snapshotPath(TaskIdSchema.parse(taskId), Sha256Schema.parse(snapshotId)),
          'utf8',
        ),
      ),
    );
    validateLocalWorkspaceSnapshotIntegrity(parsed.snapshot);
    return parsed;
  }

  async readBlob(digest: string): Promise<Buffer> {
    const bytes = await readFile(this.blobPath(Sha256Schema.parse(digest)));
    if (hashBytes(bytes) !== digest)
      throw new ChatbridgeError(
        'Stored blob fingerprint is invalid',
        'LOCAL_BLOB_INTEGRITY_INVALID',
      );
    return bytes;
  }

  private blobPath(digest: string): string {
    const valid = Sha256Schema.parse(digest);
    return path.join(this.stateRoot, 'local', 'blobs', valid.slice(0, 2), valid.slice(2));
  }

  private snapshotPath(taskId: string, snapshotId: string): string {
    return path.join(this.stateRoot, 'runs', taskId, 'local', 'snapshots', `${snapshotId}.json`);
  }

  private async assertBlob(digest: string, expectedBytes?: number): Promise<void> {
    const file = this.blobPath(digest);
    const metadata = await stat(file);
    if (expectedBytes !== undefined && metadata.size !== expectedBytes)
      throw new ChatbridgeError('Snapshot blob size mismatch', 'LOCAL_BLOB_INTEGRITY_INVALID');
    await this.readBlob(digest);
  }
}

function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
