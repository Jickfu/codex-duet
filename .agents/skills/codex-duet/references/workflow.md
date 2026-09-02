# GITHUB multi-round workflow

## Resume first

For a known task ID, first run `chatbridge duet status --task <taskId>`. Continue from its state:

- If status contains `halt.code: ITERATION_LIMIT_REACHED`, stop and report the configured limit. Do not wait, execute, or replay a message.

- `PLANNING`: finish `wait --task <taskId> --parse`, save its complete JSON output, and ingest it.
- `PLAN`: read `currentPlanArtifact`, then begin execution and continue the current iteration.
- `EXECUTING`: run `chatbridge duet reconcile-execution --task <taskId>` and follow its deterministic action. `BASELINE_CLEAN` resumes the same PLAN only when external actions are safe; `WORKTREE_IN_PROGRESS` preserves and continues existing work; `TEST_EVIDENCE_REQUIRED` preserves commits and obtains honest current-HEAD tests; `READY_FOR_PREPARE_REVIEW` proceeds directly; `CURRENT_ITERATION_M2_PREPARED` uses normal `EXECUTED` resume. Never reset, discard, recreate existing work, infer PASS, repush adopted M2 work, or blindly replay non-idempotent external effects.
- `EXECUTED`: resend `currentReviewEnvelope`, then mark reviewing only after send succeeds.
- `REVIEWING`: finish `wait --task <taskId> --parse`, save its complete JSON output, and ingest it.
- `DONE`, `BLOCKED`, `FAILED`, or `CANCELLED`: stop and report it.

## New run

1. Write the complete raw request to a temporary project-local text file. Normalize it into a separate strict TaskSpecV1 JSON candidate. Preserve objective, allowed and forbidden scope, every MUST criterion, exact literals, and non-idempotent or unknown replay requirements. Do not copy repository policy, source, diffs, secrets, or repeated role boilerplate into the TaskSpec. Compute the raw-request SHA-256 and deterministic TaskSpec integrity fingerprint without changing semantic content.
2. Run `chatbridge duet init --task <taskId> --request-file <request.md> --task-spec-file <task-spec.json> --output <planning-envelope.txt>`. Chatbridge validates identity, raw-request SHA, exact literal preservation, GitHub context, and integrity; it never invents intent. It atomically creates or verifies immutable TaskSpec and Compact task-marker evidence, so identical torn init can resume while divergent content fails. `C2C_PAYLOAD_TOO_LARGE` is a pre-Browser stop condition. Never truncate or split the projection. The raw request, TaskSpec, and fingerprint-only marker remain local and gitignored.
3. Send that envelope with `chatbridge send --task <taskId> --message-file <planning-envelope.txt>`, then use `chatbridge wait --task <taskId> --parse`. The first send normally omits `--conversation-url`. If bootstrap returns `CHATGPT_TAB_AMBIGUOUS`, stop rather than guessing; an explicit user-selected conversation may be supplied with `--conversation-url`. If an existing Chrome CDP connection requests remote-debugging authorization, tell the user and retry after authorization; do not classify that interaction as task failure.
4. Save the complete validated Envelope JSON output to a temporary file and run `chatbridge duet ingest --task <taskId> --message-file <response.json>`. Raw C2C from `chatbridge wait` remains supported for compatibility and diagnostics, with identical lifecycle validation.
5. On `BLOCKED` or `FAILED`, stop. On `PLAN`, read `.chatbridge/runs/<taskId>/plan.md`, then run `chatbridge duet begin-execution --task <taskId>` before modifying code.
6. Inspect and edit on the generated task branch, then stage and commit the candidate. Run appropriate tests on that exact committed content and record the honest result with `chatbridge duet record-tests --task <taskId> --status <status>`. Do not push, merge, open a PR, force-push, or switch to an arbitrary branch.
7. With a clean worktree, a strict descendant commit after the iteration execution base, and matching exact-HEAD test evidence, run `chatbridge duet prepare-review --task <taskId> --tests <status> --output <review-envelope.txt>`. This composes the Frozen M2 provider; do not reproduce its Git checks or push behavior.
8. Run `chatbridge send --task <taskId> --message-file <review-envelope.txt>`. Only after a confirmed send, run `chatbridge duet mark-reviewing --task <taskId>`.
9. Run `chatbridge wait --task <taskId> --parse`, save the complete validated Envelope JSON output, and ingest it.
10. On a valid next-iteration `PLAN` with no halt, automatically read `currentPlanArtifact` and repeat steps 5-9 as the same Codex Desktop Executor. The user does not need to say "continue".

Reviewer outcomes:

- `DONE`: stop and summarize implementation, tests, immutable `REVIEW_REF`, and review success.
- `BLOCKED`: show the user's required decision and stop.
- `FAILED` or `CANCELLED`: stop; never retry a terminal result automatically.
- `PLAN`: verify the iteration advanced by exactly one, inspect the review-directed corrections, and continue automatically. Preserve correct prior behavior and avoid expanding scope. Before editing, confirm the current branch is still the task branch; Frozen M2 remains the authoritative branch check at review preparation.
- `ITERATION_LIMIT_REACHED`: stop and report the durable halt. Never represent it as `DONE`.

Stop immediately for invalid C2C, illegal transition, Browser Bridge unavailability, ambiguous send, M1 or M2 safety rejection, execution-evidence divergence, unexpected branch, or any deterministic rejection. Never bypass a guard to finish.

The local TaskSpec is authoritative and the bound conversation is only a semantic cache. A Compact marker with missing or divergent TaskSpec/Planner evidence fails closed before normal review preparation; only tasks with neither marker nor TaskSpec use historical legacy envelopes. `CHATGPT_CONVERSATION_UNAVAILABLE` fails closed; M3.2c Phase 1 has no automatic or explicit rebind. Historical tasks are never synthesized or migrated silently.

For iteration 1, review the formal `BASE_REF..REVIEW_REF`. For later iterations, the generated envelope identifies a durable `PREVIOUS_REVIEW_REF..REVIEW_REF` delta focus, but formal approval remains cumulative `BASE_REF..REVIEW_REF`. Code stays on the GitHub Data Plane; never send diffs through the Browser Control Plane.
