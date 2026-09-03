import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { TaskIdSchema } from '../core/domain.js';
import { ChatbridgeError } from '../core/errors.js';
import { canonicalJson, sha256 } from '../duet/task-spec.js';
import { localWorkspaceSnapshotFingerprint, WorkspaceIdSchema } from './domain.js';
import type { LocalSnapshotAuthority } from './local-code-provider.js';
import { LOCAL_LIMITS } from './limits.js';
import { resolveWorkspacePath, validateWorkspaceRelativePath } from './path-policy.js';
import { isSensitiveWorkspacePath } from './sensitive-policy.js';
import {
  LocalSnapshotStore,
  localSnapshotSurfaceManifestFingerprint,
  type LocalSnapshotManifestV1,
} from './snapshot-store.js';
import { serializeLocalGitArtifact } from './workspace-service.js';
import { createImmutableJson } from './immutable-json.js';
import { readLocalGit, readLocalGitBytes } from './git-reader.js';
import { capturedFileDiff, type CapturedFile } from './captured-diff.js';
import { captureIgnorePolicy } from './ignore-policy.js';

const IdentitySchema = z
  .object({
    version: z.literal(1),
    workspaceId: WorkspaceIdSchema,
    canonicalRoot: z.string().min(1),
  })
  .strict();

/** Captures Git worktree bytes, never commits, pushes, executes tests, or reads live on MCP calls. */
export class GitLocalSnapshotAuthority implements LocalSnapshotAuthority {
  private constructor(
    private readonly root: string,
    private readonly taskId: string,
    private readonly workspaceId: string,
    readonly store: LocalSnapshotStore,
  ) {}

  static async open(rootInput: string, taskIdInput: string): Promise<GitLocalSnapshotAuthority> {
    const taskId = TaskIdSchema.parse(taskIdInput);
    const root = await realpath(rootInput);
    const stateRoot = path.join(root, '.chatbridge');
    await mkdir(stateRoot, { recursive: true });
    if ((await lstat(stateRoot)).isSymbolicLink())
      throw new ChatbridgeError('State root links are forbidden', 'LOCAL_PATH_LINK_REJECTED');
    const file = path.join(stateRoot, 'local', 'workspace.json');
    let identity;
    try {
      identity = IdentitySchema.parse(JSON.parse(await readFile(file, 'utf8')));
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
      const proposed = {
        version: 1 as const,
        workspaceId: randomBytes(32).toString('hex'),
        canonicalRoot: root,
      };
      await createImmutableJson(file, proposed, false);
      identity = IdentitySchema.parse(JSON.parse(await readFile(file, 'utf8')));
    }
    if (identity.canonicalRoot !== root)
      throw new ChatbridgeError(
        'Workspace root identity changed',
        'LOCAL_WORKSPACE_IDENTITY_MISMATCH',
      );
    const authority = new GitLocalSnapshotAuthority(
      root,
      taskId,
      identity.workspaceId,
      new LocalSnapshotStore(stateRoot),
    );
    if ((await realpath((await authority.git(['rev-parse', '--show-toplevel'])).trim())) !== root)
      throw new ChatbridgeError('LOCAL requires the Git worktree root', 'LOCAL_GIT_ROOT_REQUIRED');
    return authority;
  }

  async capture(taskIdInput: string) {
    if (TaskIdSchema.parse(taskIdInput) !== this.taskId)
      throw new ChatbridgeError('Capture task mismatch', 'TASK_MISMATCH');
    const before = await this.collect();
    const after = await this.collect();
    if (canonicalJson(before) !== canonicalJson(after))
      throw new ChatbridgeError(
        'Workspace changed during snapshot capture',
        'SNAPSHOT_SOURCE_CHANGED',
      );
    await this.store.publish(before);
    return before.snapshot;
  }

  async assertLiveSnapshot(snapshotId: string): Promise<void> {
    await this.store.read(this.taskId, snapshotId);
    if ((await this.capture(this.taskId)).snapshotId !== snapshotId)
      throw new ChatbridgeError(
        'Live workspace differs from bound snapshot',
        'LOCAL_BASELINE_DRIFT',
      );
  }

  private async collect(): Promise<LocalSnapshotManifestV1> {
    const head = (await this.git(['rev-parse', '--verify', 'HEAD'])).trim();
    const branch = (await this.git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    const ignorePolicy = await captureIgnorePolicy(this.root);
    // -v exposes assume-unchanged (lowercase) and skip-worktree (S). --sparse
    // preserves sparse-directory entries so unsupported semantics cannot be hidden.
    const rawIndex = await this.git(['ls-files', '--stage', '-v', '--sparse', '-z']);
    const index: string[] = [];
    for (const entry of splitNul(rawIndex)) {
      const tab = entry.indexOf('\t');
      if (tab < 0) throw new ChatbridgeError('Unsupported index record', 'LOCAL_INDEX_INVALID');
      const name = entry.slice(tab + 1);
      if (!/^H 100(?:644|755) [a-f0-9]{40} 0$/.test(entry.slice(0, tab)))
        throw new ChatbridgeError(
          'Unmerged, linked, or submodule index is unsupported',
          'LOCAL_INDEX_UNSUPPORTED',
        );
      if (isSensitiveWorkspacePath(name)) continue;
      validateWorkspaceRelativePath(name);
      index.push(entry);
    }
    const names = [
      ...new Set(
        splitNul(await this.git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])),
      ),
    ]
      .filter((name) => !isSensitiveWorkspacePath(name))
      .sort();
    if (names.length > LOCAL_LIMITS.files) throw limit();
    const entries: LocalSnapshotManifestV1['entries'] = [];
    const current = new Map<string, CapturedFile>();
    let totalBytes = 0;
    for (const name of names) {
      validateWorkspaceRelativePath(name);
      let resolved;
      try {
        resolved = await resolveWorkspacePath(this.root, name);
      } catch (error: any) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      const before = await lstat(resolved.absolutePath);
      if (!before.isFile())
        throw new ChatbridgeError(
          'Only regular workspace files are supported',
          'LOCAL_FILE_UNSUPPORTED',
        );
      if (
        before.size > LOCAL_LIMITS.singleFileBytes ||
        totalBytes + before.size > LOCAL_LIMITS.capturedBytes
      )
        throw limit();
      const bytes = await readFile(resolved.absolutePath);
      const after = await lstat(resolved.absolutePath);
      await resolveWorkspacePath(this.root, name);
      if (
        !after.isFile() ||
        before.ino !== after.ino ||
        before.mode !== after.mode ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs ||
        bytes.length !== before.size
      )
        throw new ChatbridgeError('File changed during capture', 'SNAPSHOT_SOURCE_CHANGED');
      totalBytes += bytes.length;
      entries.push({
        path: name,
        bytes: bytes.length,
        blobSha256: await this.store.putBlob(bytes),
      });
      current.set(name, { bytes, executable: Boolean(before.mode & 0o111) });
    }
    const statusRecords = splitNul(
      await this.git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']),
    );
    const allowedStatus = statusRecords.filter(
      (record) => !isSensitiveWorkspacePath(record.slice(3)),
    );
    for (const record of allowedStatus) validateWorkspaceRelativePath(record.slice(3));
    const status = allowedStatus.join('\0');
    const diffParts: string[] = [];
    let diffBytes = 0;
    const originals = new Map<string, { mode: string; oid: string }>();
    for (const record of splitNul(await this.git(['ls-tree', '-r', '-z', head]))) {
      const tab = record.indexOf('\t');
      const name = record.slice(tab + 1);
      if (isSensitiveWorkspacePath(name)) continue;
      const match = /^(100644|100755) blob ([a-f0-9]{40})$/.exec(record.slice(0, tab));
      if (!match) throw new ChatbridgeError('Unsupported HEAD entry', 'LOCAL_INDEX_UNSUPPORTED');
      validateWorkspaceRelativePath(name);
      originals.set(name, { mode: match[1]!, oid: match[2]! });
    }
    const diffNames = [...new Set([...current.keys(), ...originals.keys()])].sort();
    if (diffNames.length > LOCAL_LIMITS.files) throw limit();
    for (const name of diffNames) validateWorkspaceRelativePath(name);
    let headBytes = 0;
    for (const name of diffNames) {
      const original = originals.get(name);
      let before: CapturedFile | undefined;
      if (original) {
        const bytes = await readLocalGitBytes(this.root, ['cat-file', 'blob', original.oid], {
          maxBytes: LOCAL_LIMITS.singleFileBytes,
        });
        headBytes += bytes.length;
        if (headBytes > LOCAL_LIMITS.capturedBytes) throw limit();
        before = { bytes, executable: original.mode === '100755' };
      }
      const diff = await capturedFileDiff(name, before, current.get(name));
      diffBytes += Buffer.byteLength(diff);
      if (diffBytes > LOCAL_LIMITS.materializedDiffBytes) throw limit();
      diffParts.push(diff);
    }
    const statusHash = await this.store.putBlob(
      serializeLocalGitArtifact({
        version: 1,
        kind: 'STATUS',
        paths: allowedStatus.map((record) => record.slice(3)),
        contentBase64: Buffer.from(status).toString('base64'),
      }),
    );
    const diffHash = await this.store.putBlob(
      serializeLocalGitArtifact({
        version: 1,
        kind: 'DIFF',
        paths: diffNames,
        contentBase64: Buffer.from(diffParts.join('')).toString('base64'),
      }),
    );
    const content = {
      version: 1 as const,
      kind: 'LOCAL_WORKSPACE_SNAPSHOT' as const,
      workspaceId: this.workspaceId,
      git: {
        head,
        ...(branch === 'HEAD' ? {} : { branch }),
        detached: branch === 'HEAD',
        indexManifestSha256: sha256(canonicalJson({ index, ignorePolicy })),
        statusSha256: sha256(status),
      },
      surface: {
        policyVersion: 1 as const,
        manifestSha256: localSnapshotSurfaceManifestFingerprint(entries),
        fileCount: entries.length,
        totalBytes,
      },
      artifacts: { gitStatusSha256: statusHash, gitDiffSha256: diffHash },
    };
    return {
      version: 1,
      taskId: this.taskId,
      snapshot: { ...content, snapshotId: localWorkspaceSnapshotFingerprint(content) },
      entries,
      gitStatusBlobSha256: statusHash,
      gitDiffBlobSha256: diffHash,
    };
  }

  private git(args: string[], diff = false): Promise<string> {
    return readLocalGit(this.root, args, { diff });
  }
}

function splitNul(value: string): string[] {
  return value.split('\0').filter(Boolean);
}
function limit() {
  return new ChatbridgeError('Snapshot exceeds the hard limit', 'SNAPSHOT_LIMIT_EXCEEDED');
}
