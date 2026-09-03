# ADR-022: LOCAL execution observation and durable cancellation

Status: accepted for M4 implementation; not an M4 freeze.

## Decision

`local reconcile-execution` is an EXECUTING-only observation under the shared task lock. It validates the provider context and review-history prefix, captures current live identity and reports UNCHANGED, WORKTREE_IN_PROGRESS or REVIEW_PREPARED. The last outcome means the provider has published the current immutable target but the lifecycle checkpoint has not advanced. It reports the target and whether live content still matches it; it does not claim tests were rerun or current edits were reviewed.

No lifecycle/provider checkpoint is written by reconciliation. Capture may publish snapshot metadata/blobs under `.chatbridge`. It never edits source, executes tests, prepares a new review, sends a message or changes state. Explicit `run-prepare-review` remains the recovery operation for the already published target. Reconciliation rejects other states, including BLOCKED and terminal states.

`local run-cancel --reason <text>` records CANCELLED plus the original state, bounded nonblank reason and timestamp. It follows the unchanged shared transition table. Validation reconstructs and checks the pre-cancellation lifecycle authority; cancellation cannot conceal an invalid plan, review or response chain. Exact reason replay preserves the original timestamp; a different reason cannot overwrite it. DONE and FAILED cannot be cancelled.

Cancellation and response application share the task lock. A response that passed preflight before cancellation must recheck state under that lock and cannot advance a cancelled run. Its ingress record may remain PENDING, not ACCEPTED. Already applied exact responses remain idempotently replayable without restoring the previous state. Cancellation does not roll back source changes, terminate external processes, retract a sent message, or resolve SEND_OUTCOME_UNKNOWN. Preserve transport evidence for diagnosis.

## Boundaries

BLOCKED may be explicitly cancelled, but not automatically resumed. The accepted response is bound to an immutable control hash; changing its outcome requires a separately designed decision/control-identity amendment, not replay or reset. No frozen GITHUB/M0–M3 schema or transition is changed. Exact Playwright send proof, MCP lifecycle ingress and real Browser acceptance remain separate work.
