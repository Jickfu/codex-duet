import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
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
import { validateWorkspaceRelativePath } from './path-policy.js';

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
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, bytes, { flag: 'wx' });
      await link(temporary, file);
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = await readFile(file);
      if (!existing.equals(bytes))
        throw new ChatbridgeError('Content-addressed blob collision', 'LOCAL_BLOB_COLLISION');
    } finally {
      await unlink(temporary).catch((error: any) => {
        if (error?.code !== 'ENOENT') throw error;
      });
    }
    return digest;
  }

  async publish(manifest: LocalSnapshotManifestV1): Promise<void> {
    const parsed = LocalSnapshotManifestV1Schema.parse(manifest);
    validateManifestAuthority(parsed);
    for (const entry of parsed.entries) await this.assertBlob(entry.blobSha256, entry.bytes);
    await this.assertBlob(parsed.gitStatusBlobSha256);
    await this.assertBlob(parsed.gitDiffBlobSha256);
    const file = this.snapshotPath(parsed.taskId, parsed.snapshot.snapshotId);
    await mkdir(path.dirname(file), { recursive: true });
    const serialized = `${canonicalJson(parsed)}\n`;
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, serialized, { flag: 'wx' });
      await link(temporary, file);
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      if ((await readFile(file, 'utf8')) !== serialized)
        throw new ChatbridgeError(
          'Snapshot identity already has different bytes',
          'LOCAL_SNAPSHOT_IMMUTABLE',
        );
    } finally {
      await unlink(temporary).catch((error: any) => {
        if (error?.code !== 'ENOENT') throw error;
      });
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
    validateManifestAuthority(parsed, { taskId, snapshotId });
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

function validateManifestAuthority(
  manifest: LocalSnapshotManifestV1,
  expected?: { taskId: string; snapshotId: string },
): void {
  validateLocalWorkspaceSnapshotIntegrity(manifest.snapshot);
  if (
    expected &&
    (manifest.taskId !== expected.taskId || manifest.snapshot.snapshotId !== expected.snapshotId)
  )
    throw new ChatbridgeError(
      'Snapshot request identity does not match manifest',
      'LOCAL_MANIFEST_IDENTITY_MISMATCH',
    );
  const canonicalEntries = [...manifest.entries].sort(comparePaths);
  if (canonicalJson(canonicalEntries) !== canonicalJson(manifest.entries))
    throw new ChatbridgeError(
      'Snapshot entries are not canonically sorted',
      'LOCAL_MANIFEST_INVALID',
    );
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const entry of manifest.entries) {
    validateWorkspaceRelativePath(entry.path);
    if (paths.has(entry.path))
      throw new ChatbridgeError('Snapshot entry paths are not unique', 'LOCAL_MANIFEST_INVALID');
    paths.add(entry.path);
    totalBytes += entry.bytes;
  }
  if (
    manifest.snapshot.surface.fileCount !== manifest.entries.length ||
    manifest.snapshot.surface.totalBytes !== totalBytes
  )
    throw new ChatbridgeError('Snapshot surface totals are inconsistent', 'LOCAL_MANIFEST_INVALID');
  if (
    manifest.snapshot.surface.manifestSha256 !==
    localSnapshotSurfaceManifestFingerprint(manifest.entries)
  )
    throw new ChatbridgeError(
      'Snapshot surface manifest fingerprint is invalid',
      'LOCAL_MANIFEST_INTEGRITY_INVALID',
    );
  if (
    manifest.snapshot.artifacts.gitStatusSha256 !== manifest.gitStatusBlobSha256 ||
    manifest.snapshot.artifacts.gitDiffSha256 !== manifest.gitDiffBlobSha256
  )
    throw new ChatbridgeError(
      'Snapshot artifact fingerprint is invalid',
      'LOCAL_MANIFEST_INTEGRITY_INVALID',
    );
}

function comparePaths(left: { path: string }, right: { path: string }): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
