# ADR-014: EXECUTING Crash Reconciliation

## Status

Accepted design. Implementation is complete with 224 automated tests passing; real Desktop crash acceptance remains manual and required before freeze.

## Context

Frozen M3.0/M3.1 persists `EXECUTING` before Codex edits, tests, and commits, but does not persist the execution-starting branch and `HEAD`, iteration execution base, or HEAD-bound test evidence. After a Desktop or process interruption, the existing `EXECUTION_RECOVERY_REQUIRED` result therefore cannot distinguish an untouched baseline, partial worktree edits, committed work, completed tests, or the torn state where Frozen M2 finished review preparation before M3 persisted `EXECUTED`.

Recovery must preserve Frozen M0, M1, M2, M3.0, M3.1, and M3.2a contracts. It cannot add a C2C state, change `DuetRunCheckpointV2`, alter cumulative review identity, duplicate M2 push safety, rebind a conversation, or start another Executor.

Git evidence cannot prove arbitrary non-Git side effects. M3.2b reconciles durable repository-development execution state using Git/worktree, explicit test evidence, and Frozen M2 evidence. It does not claim exactly-once recovery for database writes, deployments, remote API mutations, publishing, cloud mutations, or arbitrary external commands. Unverifiable non-idempotent effects fail closed and are never blindly replayed.

## Decision

### Iteration-scoped execution evidence

Each iteration owns an independent, historical, project-scoped, gitignored sidecar:

```text
.chatbridge/runs/<taskId>/iterations/<N>/execution.json
```

The conceptual strict schema is:

```ts
type ExecutionCheckpointV1 = {
  version: 1;
  taskId: string;
  iteration: number;
  planSha256: string;
  baseline: {
    taskBranch: string;
    head: string;
  };
  startedAt: string;
  tests?: {
    status: 'PASS' | 'FAIL' | 'NOT_RUN';
    head: string;
    recordedAt: string;
  };
};
```

Implementation must use strict Zod validation, existing path-safe task ID rules, validated positive iteration numbers, full commit SHAs, atomic writes, and iteration-local paths. The sidecar stores no source snapshot, diff text, command log, environment dump, secret, or arbitrary external-effect journal. `DuetRunCheckpointV2` remains orchestration and review-history state; `execution.json` is orthogonal execution-recovery evidence, as M3.2a `browser.json` is orthogonal Browser routing evidence.

### Execution baseline

Every iteration has one immutable `EXECUTION_BASE_REF`:

```text
iteration 1     → BASE_REF
iteration N > 1 → PREVIOUS_REVIEW_REF
```

This iteration-local base is not the task-level formal review base. ADR-012 remains unchanged: every formal review is cumulative `BASE_REF..CURRENT_REVIEW_REF`, while later-iteration delta focus is `PREVIOUS_REVIEW_REF..CURRENT_REVIEW_REF`.

### Crash-safe begin-execution

Before workspace mutation, `duet begin-execution` must verify the task branch, `HEAD == EXECUTION_BASE_REF`, a clean conflict-free worktree, and the current plan artifact/hash. It must never reset, clean, stash, switch away, or adopt an unexpected commit.

The durable order is:

```text
inspect and validate baseline
→ atomically write execution.json
→ persist M3 state EXECUTING
→ return success
→ Codex may edit
```

A crash after sidecar write but before `EXECUTING` persistence leaves a harmless orphan while state remains `PLAN`; `begin-execution` may reuse it only when task, iteration, plan hash, branch, and `HEAD` all match. Mismatch fails closed. A legacy V1/V2 run already in `EXECUTING` without the sidecar returns `LEGACY_EXECUTION_RECOVERY_REQUIRED`; no baseline is invented.

### Read-only inspection and reconciliation

A single `ExecutionWorkspaceInspector` boundary may use only read-only Git operations such as symbolic-ref, rev-parse, status/diff metadata, conflict detection, and merge-base ancestry. It cannot checkout, reset, clean, stash, commit, push, or mutate the workspace. It may reuse `GitRunner` and read Frozen M2 status, but cannot reproduce `GitHubCodeProvider.getReviewTarget()` push or remote-verification logic.

The public command is:

```text
chatbridge duet reconcile-execution --task <taskId>
```

It is valid only in durable `EXECUTING`. Its structured output contains compact identity and classification metadata such as task, iteration, execution base, branch, `HEAD`, clean/conflicted flags, action, and `externalEffects: "UNVERIFIED"`; it never emits source or complete diffs.

Core classifications are:

| Classification                  | Deterministic evidence                                                                                                                           | Required action                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BASELINE_CLEAN`                | Correct branch, `HEAD == EXECUTION_BASE_REF`, clean, conflict-free, no newer current-iteration M2 review                                         | Resume the same durable PLAN under the current Codex Executor; this proves only that no Git-visible execution effect exists.                      |
| `WORKTREE_IN_PROGRESS`          | Correct branch and valid base/descendant `HEAD`, with dirty worktree                                                                             | Preserve and inspect existing work against the same PLAN; continue from current state, never reset, discard, stash, or replay from the beginning. |
| `COMMITTED_CLEAN`               | Correct branch, clean conflict-free worktree, and `HEAD` is a strict descendant of the execution base, with no newer current-iteration M2 review | Adopt existing commits rather than recreate edits; decide the next step from exact-HEAD test evidence.                                            |
| `TEST_EVIDENCE_REQUIRED`        | `COMMITTED_CLEAN` but no test evidence or evidence bound to another `HEAD`                                                                       | Preserve code and obtain honest tests/evidence; never infer or inherit PASS.                                                                      |
| `READY_FOR_PREPARE_REVIEW`      | `COMMITTED_CLEAN` plus valid test evidence whose `head == current HEAD`                                                                          | Do not replay edits or rerun tests merely because of restart; call normal `duet prepare-review`.                                                  |
| `CURRENT_ITERATION_M2_PREPARED` | Frozen M2 conclusively completed the current iteration and all adoption checks pass                                                              | Durably adopt M2 evidence into M3 and transition `EXECUTING → EXECUTED` without another push.                                                     |

Wrong/detached branch, conflicts, non-descendant `HEAD`, baseline or plan mismatch, unexpected iteration, or inconsistent M2/local identity is divergence and fails closed. `reconcile-execution` is read-only for every ordinary classification. Its only allowed automatic durable mutation is adoption of conclusively completed Frozen M2 current-iteration work.

### Durable test evidence

The public primitive is:

```text
chatbridge duet record-tests --task <taskId> --status PASS|FAIL|NOT_RUN
```

It is valid only in `EXECUTING` and only when the current branch is the task branch, the worktree is clean and conflict-free, and `HEAD` is a descendant of `EXECUTION_BASE_REF`. It atomically records status, full current `HEAD`, and timestamp in the iteration sidecar. Evidence is valid only while `tests.head == current HEAD`; a later commit makes it stale.

The recommended Executor order is edit, commit candidate, run tests on committed content, record tests at exact `HEAD`, then prepare review. After a failure, fixes produce a new commit and new evidence. Existing `duet prepare-review --tests PASS|FAIL|NOT_RUN` remains public and compatible; when execution evidence exists, its status and `HEAD` must match rather than being silently overridden.

### Frozen M2 torn-state adoption

The critical window is Frozen M2 safe push, remote verification, and checkpoint persistence succeeding before M3 writes the review envelope and state `EXECUTED`. Reconciliation must not push again.

For iteration N, an M2 `EXECUTED` checkpoint is current only when its `reviewRef != EXECUTION_BASE_REF`, the execution base is its ancestor, local `HEAD == reviewRef`, repository and task branch identities match, test status is present and consistent, the worktree is clean and conflict-free, and previous-review monotonicity is valid. This distinction prevents iteration N from mistaking iteration N-1 evidence for current work.

When every condition holds, reconciliation constructs `GitHubReviewTarget` from durable Frozen M2 status, deterministically reconstructs and atomically writes the iteration review envelope, persists the current iteration review target, and uses the existing `EXECUTING → EXECUTED` transition. A torn review-envelope artifact may be overwritten deterministically. If M3 is already `EXECUTED`, normal Frozen resume rules apply. If local `HEAD` advanced beyond or differs from M2 `reviewRef`, adoption is forbidden and the run fails closed.

### Multi-round, concurrency, and compatibility

Iteration N reconciles only `EXECUTION_BASE_REF_N..HEAD`; it never changes the immutable task `BASE_REF` or ADR-012 formal range. Each later iteration creates its own `execution.json` and retains earlier evidence.

`begin-execution`, `record-tests`, `reconcile-execution`, and `prepare-review` for one task must be serialized with a cross-process-safe project/task operation lock, not an in-process mutex. New sidecars begin only with M3.2b-enabled execution. Legacy `EXECUTING` runs without one remain manual recovery cases.

The current Codex Desktop remains the sole Executor. Deterministic TypeScript inspects, classifies, and persists lifecycle evidence only; it never launches a second Codex, Codex CLI, Codex SDK, daemon, or Node coding loop.

Recommended error taxonomy includes `EXECUTION_CHECKPOINT_MISSING`, `EXECUTION_CHECKPOINT_INVALID`, `EXECUTION_HISTORY_DIVERGED`, `EXECUTION_BRANCH_MISMATCH`, `EXECUTION_CONFLICTED`, `EXECUTION_BASE_MISMATCH`, `TEST_EVIDENCE_REQUIRED`, `TEST_EVIDENCE_STALE`, `M2_REVIEW_EVIDENCE_DIVERGED`, and `LEGACY_EXECUTION_RECOVERY_REQUIRED`. Implementations may consolidate names only when distinct recovery actions remain machine-readable.

## Implementation acceptance targets

Implementation must prove at least:

1. Crash after successful begin and before edits → `BASELINE_CLEAN`.
2. Crash with partial uncommitted edits → `WORKTREE_IN_PROGRESS`, workspace untouched.
3. Crash with committed work but no exact-HEAD tests → `TEST_EVIDENCE_REQUIRED`, no re-edit.
4. Crash after commit, PASS, and `record-tests` → `READY_FOR_PREPARE_REVIEW`, no edit replay.
5. Crash after Frozen M2 push/verify/checkpoint but before M3 persistence → adopt M2 evidence into `EXECUTED`, no repush.
6. Diverged `HEAD` or any identity mismatch → fail closed.

After implementation, real Desktop dogfood must terminate once after an uncommitted edit and once after Frozen M2 completion but before M3 persistence. A deterministic test/dev-only crash hook is acceptable for the narrow second window but cannot enter the normal product path.

## Consequences

- M3.2b provides deterministic crash reconciliation and no blind PLAN replay, not universal exactly-once execution.
- Dirty work and valid commits are preserved and reconciled rather than destroyed or recreated.
- PASS is durable only when explicitly recorded against the exact current full SHA.
- Frozen M2 remains the sole owner of push, remote verification, and review-ref creation.
- No C2C schema, `TaskState`, `DuetRunCheckpointV2`, Browser binding, CodeProvider review identity, or ADR-012 change is required.
- M3.2c UX hardening and M4 Local MCP remain out of scope.
