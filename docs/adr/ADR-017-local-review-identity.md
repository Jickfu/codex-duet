# ADR-017: LOCAL immutable snapshot and review authority

Status: Accepted / M4.0 contract freeze

## Decision

M4 LOCAL V1 supports local Git worktrees only. GitHub, commits, and pushes are not required, but Git supplies the stable HEAD, index, staged/unstaged, rename, deletion, and dirty-state vocabulary. Arbitrary non-Git directories are outside M4.

`LocalWorkspaceSnapshotV1` and `LocalReviewTargetV1` are separate authorities:

- A workspace snapshot identifies one complete, immutable, allowed review surface. It consists of a canonical manifest, raw content hashes, Git index/status identity, and snapshot-bound status/diff convenience artifacts. A snapshot is atomically published only after all eligible bytes have been captured into the content-addressed store. No later read may fill missing blobs from the live workspace.
- A review target binds task, iteration, baseline, current and optional previous review snapshots, exact snapshot-bound test evidence, and execution summary. Its `reviewTargetSha256` is the formal LOCAL review authority. It is never represented as a Git `REVIEW_REF`.

The formal cumulative identity is `BASELINE_SNAPSHOT -> REVIEW_SNAPSHOT_N`; later iterations focus on `REVIEW_SNAPSHOT_N-1 -> REVIEW_SNAPSHOT_N`. The observed delta is `UNATTRIBUTED_NET_DELTA`: it proves state transition, not that Codex authored every byte.

The stable random `workspaceId` is stored privately with the canonical root. MCP responses never expose the absolute root or derive a public identifier from it.

Both authorities use the existing recursively key-sorted UTF-8 canonical JSON contract. `snapshotId` is `SHA-256(canonicalJson(snapshot without snapshotId))`; `reviewTargetSha256` is `SHA-256(canonicalJson(review target without reviewTargetSha256))`. The self-hash field is excluded only from its own fingerprint. Readers must recompute and reject mismatches with `LOCAL_SNAPSHOT_INTEGRITY_INVALID` or `LOCAL_REVIEW_TARGET_INTEGRITY_INVALID`; schema-valid hash syntax alone is never sufficient authority.

## Snapshot and read invariants

Snapshot creation enumerates the complete eligible surface, performs pre-read and post-read stability checks, stores immutable blobs, persists the manifest, then atomically publishes `snapshotId`. Source drift fails with `SNAPSHOT_SOURCE_CHANGED`; any hard limit fails with `SNAPSHOT_LIMIT_EXCEEDED`. A partial or truncated snapshot cannot be used for formal review.

Every review-mode MCP read explicitly names `taskId` and `snapshotId`; there is no implicit `latest`, `current`, or live-workspace fallback. Git textual diff is a snapshot-bound reviewer artifact, not the root identity. Any internal Git invocation uses fixed arguments, disables external diff/text conversion and repository-configured external helpers, and never exposes command execution through MCP.

The path surface accepts only workspace-relative POSIX paths. Absolute, UNC, traversal, device, alternate-data-stream, symlink, junction, reparse-point escape, and case-insensitive containment violations fail closed. The explicit credential-payload deny policy covers environment files, key/certificate stores, SSH/cloud credential locations, package credential files, `.git`, and `.chatbridge`; it does not claim to scan arbitrary source code for secrets. Denied names and contents are absent from reads, search, diff bodies, and directory listings. A task requiring a denied path is `LOCAL_SENSITIVE_PATH_UNREVIEWABLE`.

## Orchestration consequences

Planner/Discussion binds to the baseline snapshot. Before ingesting the final PLAN, the live reviewable surface must still equal that baseline or fail with `LOCAL_BASELINE_DRIFT`. Before a later review-directed iteration begins, live state must equal the previous reviewed snapshot.

Tests run only under Codex authority. PASS is recorded against an exact candidate `snapshotId` only after the live reviewable surface is reverified unchanged. MCP only reports durable task/iteration/snapshot-bound evidence and never runs commands or infers PASS.

LOCAL adds an additive checkpoint variant without modifying frozen GITHUB checkpoint schemas. C2C remains version 1; role-specific content carries and requires exact echo of LOCAL identity.

Browser responses and the disabled-by-default `submit_response` capability both enter one `ResponseIngressService`. First accepted response wins; identical replay is idempotent and a divergent second response fails with `RESPONSE_ALREADY_ACCEPTED`. `submit_response` requires an explicit task/control-scoped high-entropy capability and may atomically mutate only task-scoped `.chatbridge` state. It is not a second lifecycle authority.

## M4 phase boundary

- M4.0: this ADR and the snapshot/review-target schemas.
- M4.1: root, path, deny-policy, and immutable blob-store primitives.
- M4.2: snapshot-bound read-only workspace service and eight MCP read tools.
- M4.3: `LocalCodeProvider`, LOCAL checkpoint, drift, recovery, and multi-round identity.
- M4.4: localhost MCP, capabilities, disabled-by-default `submit_response`, and shared response ingress.
- M4.5: orchestration integration, crash/resume guards, local acceptance, and documentation freeze.

Public remote exposure and cloudflared remain M5.
