# GITHUB multi-round workflow

## Resume first

For a known task ID, first run `chatbridge duet status --task <taskId>`. Continue from its state:

- If status contains `halt.code: ITERATION_LIMIT_REACHED`, stop and report the configured limit. Do not wait, execute, or replay a message.

- `PLANNING`: finish `wait --task <taskId> --parse`, save its complete JSON output, and ingest it.
- `PLAN`: read `currentPlanArtifact`, then begin execution and continue the current iteration.
- `EXECUTING`: stop with `EXECUTION_RECOVERY_REQUIRED`; never replay edits blindly.
- `EXECUTED`: resend `currentReviewEnvelope`, then mark reviewing only after send succeeds.
- `REVIEWING`: finish `wait --task <taskId> --parse`, save its complete JSON output, and ingest it.
- `DONE`, `BLOCKED`, `FAILED`, or `CANCELLED`: stop and report it.

## New run

1. Write the normalized request to a temporary project-local text file.
2. Run `chatbridge duet init --task <taskId> --request-file <request.md> --output <planning-envelope.txt>`.
3. Send that envelope with `chatbridge send --task <taskId> --message-file <planning-envelope.txt>`, then use `chatbridge wait --task <taskId> --parse`. The first send normally omits `--conversation-url`. If bootstrap returns `CHATGPT_TAB_AMBIGUOUS`, stop rather than guessing; an explicit user-selected conversation may be supplied with `--conversation-url`. If an existing Chrome CDP connection requests remote-debugging authorization, tell the user and retry after authorization; do not classify that interaction as task failure.
4. Save the complete validated Envelope JSON output to a temporary file and run `chatbridge duet ingest --task <taskId> --message-file <response.json>`. Raw C2C from `chatbridge wait` remains supported for compatibility and diagnostics, with identical lifecycle validation.
5. On `BLOCKED` or `FAILED`, stop. On `PLAN`, read `.chatbridge/runs/<taskId>/plan.md`, then run `chatbridge duet begin-execution --task <taskId>` before modifying code.
6. Inspect, edit, test, stage, and commit on the generated task branch. Do not push, merge, open a PR, force-push, or switch to an arbitrary branch. Record tests honestly as `PASS`, `FAIL`, or `NOT_RUN`.
7. With a clean worktree and at least one commit after `BASE_REF`, run `chatbridge duet prepare-review --task <taskId> --tests <status> --output <review-envelope.txt>`. This composes the Frozen M2 provider; do not reproduce its Git checks or push behavior.
8. Run `chatbridge send --task <taskId> --message-file <review-envelope.txt>`. Only after a confirmed send, run `chatbridge duet mark-reviewing --task <taskId>`.
9. Run `chatbridge wait --task <taskId> --parse`, save the complete validated Envelope JSON output, and ingest it.
10. On a valid next-iteration `PLAN` with no halt, automatically read `currentPlanArtifact` and repeat steps 5-9 as the same Codex Desktop Executor. The user does not need to say "continue".

Reviewer outcomes:

- `DONE`: stop and summarize implementation, tests, immutable `REVIEW_REF`, and review success.
- `BLOCKED`: show the user's required decision and stop.
- `FAILED` or `CANCELLED`: stop; never retry a terminal result automatically.
- `PLAN`: verify the iteration advanced by exactly one, inspect the review-directed corrections, and continue automatically. Preserve correct prior behavior and avoid expanding scope. Before editing, confirm the current branch is still the task branch; Frozen M2 remains the authoritative branch check at review preparation.
- `ITERATION_LIMIT_REACHED`: stop and report the durable halt. Never represent it as `DONE`.

Stop immediately for invalid C2C, illegal transition, Browser Bridge unavailability, ambiguous send, M1 or M2 safety rejection, unexpected branch, dirty-worktree rejection, or `EXECUTION_RECOVERY_REQUIRED`. Never bypass a guard to finish.

For iteration 1, review the formal `BASE_REF..REVIEW_REF`. For later iterations, the generated envelope identifies a durable `PREVIOUS_REVIEW_REF..REVIEW_REF` delta focus, but formal approval remains cumulative `BASE_REF..REVIEW_REF`. Code stays on the GitHub Data Plane; never send diffs through the Browser Control Plane.
