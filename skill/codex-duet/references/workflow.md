# GITHUB multi-round workflow

## Resume first

For a known task ID, first run `chatbridge duet status --task <taskId>`. Continue from its state:

- If status contains `halt.code: ITERATION_LIMIT_REACHED`, stop and report the configured limit. Do not wait, execute, or replay a message.

- `PLANNING`: inspect TaskInteractionPolicyV1 and the selected provider checkpoint. `PLAYWRIGHT_CLI` finishes `wait --task <taskId> --parse`; `CODEX_BROWSER` resumes only the recorded operation: `PREPARED` may proceed to mark-attempted and one Send gesture, unresolved `ATTEMPTED`/`OUTCOME_UNKNOWN` stops without replay, `CONFIRMED` waits for and records the response, and `RESPONDED` ingests only matching bytes.
- `PLAN`: read `currentPlanArtifact`, then begin execution and continue the current iteration.
- `EXECUTING`: run `chatbridge duet reconcile-execution --task <taskId>` and follow its deterministic action. `BASELINE_CLEAN` resumes the same PLAN only when external actions are safe; `WORKTREE_IN_PROGRESS` preserves and continues existing work; `TEST_EVIDENCE_REQUIRED` preserves commits and obtains honest current-HEAD tests; `READY_FOR_PREPARE_REVIEW` proceeds directly; `CURRENT_ITERATION_M2_PREPARED` uses normal `EXECUTED` resume. Never reset, discard, recreate existing work, infer PASS, repush adopted M2 work, or blindly replay non-idempotent external effects.
- `EXECUTED`: send `currentReviewEnvelope` through the immutable selected provider, then mark reviewing only after that provider records confirmed send. Never call Playwright commands for a CODEX_BROWSER task.
- `REVIEWING`: receive through the selected provider. `PLAYWRIGHT_CLI` finishes `wait --task <taskId> --parse`; `CODEX_BROWSER` follows its durable checkpoint and never replays `ATTEMPTED`, `CONFIRMED`, or `OUTCOME_UNKNOWN`. Save and ingest only the provider-validated complete response.
- `DONE`, `BLOCKED`, `FAILED`, or `CANCELLED`: stop and report it.

## New run

1. Write the complete raw request to a temporary project-local text file. Normalize it into a separate strict TaskSpecV1 JSON candidate. Preserve objective, allowed and forbidden scope, every MUST criterion, exact literals, and non-idempotent or unknown replay requirements. Do not copy repository policy, source, diffs, secrets, or repeated role boilerplate into the TaskSpec. Compute the raw-request SHA-256 and deterministic TaskSpec integrity fingerprint without changing semantic content. Create TaskInteractionPolicyV1 and run `chatbridge duet interaction-init --task <taskId> --policy-file <interaction.json>` before any Browser action. The provider and Discussion choice are immutable.
2. Run `chatbridge duet init --task <taskId> --request-file <request.md> --interaction-policy-file <interaction.json> --task-spec-file <task-spec.json> --output <planning-envelope.txt>`. Chatbridge persists policy before the run, validates identity, raw-request SHA, exact literal preservation, GitHub context, and integrity; it never invents intent. It atomically creates or verifies immutable TaskSpec and Compact task-marker evidence, so identical torn init can resume while divergent content fails. `C2C_PAYLOAD_TOO_LARGE` is a pre-Browser stop condition. Never truncate or split the projection. The raw request, TaskSpec, and fingerprint-only marker remain local and gitignored.
3. If Discussion is enabled, perform one to three strict Discussion rounds before sending the Planner envelope. Prepare each round with `chatbridge duet discussion-prepare`, exchange it using only the selected provider, and ingest only DiscussionResponseV1 with `discussion-ingest`. Continue only until `CONVERGED`; Discussion never changes the lifecycle iteration and never masquerades as Raw C2C. Then send the Planner envelope through the selected provider. `PLAYWRIGHT_CLI` uses `chatbridge send --task <taskId>` and `chatbridge wait --task <taskId> --parse`. `CODEX_BROWSER` uses `codex-browser-prepare`, then persists `codex-browser-mark-attempted` immediately before the UI Send gesture, then uses `codex-browser-complete` and `codex-browser-receive`; exact conversation identity is mandatory for confirmation, and unresolved `ATTEMPTED` or `OUTCOME_UNKNOWN` forbids automatic resend.
4. Save the complete validated Envelope JSON output to a temporary file and run `chatbridge duet ingest --task <taskId> --message-file <response.json>`. Raw C2C from `chatbridge wait` remains supported for compatibility and diagnostics, with identical lifecycle validation.
5. On `BLOCKED` or `FAILED`, stop. On `PLAN`, read `.chatbridge/runs/<taskId>/plan.md`, then run `chatbridge duet begin-execution --task <taskId>` before modifying code.
6. Inspect and edit on the generated task branch, then stage and commit the candidate. Run appropriate tests on that exact committed content and record the honest result with `chatbridge duet record-tests --task <taskId> --status <status>`. Do not push, merge, open a PR, force-push, or switch to an arbitrary branch.
7. With a clean worktree, a strict descendant commit after the iteration execution base, and matching exact-HEAD test evidence, run `chatbridge duet prepare-review --task <taskId> --tests <status> --output <review-envelope.txt>`. This composes the Frozen M2 provider; do not reproduce its Git checks or push behavior.
8. Send the review envelope through TaskInteractionPolicyV1's selected provider. `PLAYWRIGHT_CLI` runs `chatbridge send --task <taskId> --message-file <review-envelope.txt>`. `CODEX_BROWSER` runs prepare, mark-attempted immediately before its one UI gesture, and complete with exact conversation identity. Only after provider-confirmed send, run `chatbridge duet mark-reviewing --task <taskId>`.
9. Receive through the same provider. `PLAYWRIGHT_CLI` runs `chatbridge wait --task <taskId> --parse`. `CODEX_BROWSER` records the exact-conversation response and then ingests only the matching immutable response bytes. Never replay an unresolved attempted, confirmed, or unknown operation.
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
