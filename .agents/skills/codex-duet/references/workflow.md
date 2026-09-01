# GITHUB single-round workflow

## Resume first

For a known task ID, first run `chatbridge duet status --task <taskId>`. Continue from its state:

- `PLANNING`: finish `wait` and ingest.
- `PLAN`: begin execution.
- `EXECUTING`: stop with `EXECUTION_RECOVERY_REQUIRED`; never replay edits blindly.
- `EXECUTED`: resend the durable `reviewEnvelope`, then mark reviewing only after send succeeds.
- `REVIEWING`: finish `wait` and ingest.
- `DONE`, `BLOCKED`, `FAILED`, or `CANCELLED`: stop and report it.

## New run

1. Write the normalized request to a temporary project-local text file.
2. Run `chatbridge duet init --task <taskId> --request-file <request.md> --output <planning-envelope.txt>`.
3. Send that envelope with `chatbridge send --message-file <planning-envelope.txt>`, then use `chatbridge wait`. If an existing Chrome CDP connection requests remote-debugging authorization, tell the user and retry after authorization; do not classify that interaction as task failure.
4. Save the complete response to a temporary file and run `chatbridge duet ingest --task <taskId> --message-file <response.txt>`.
5. On `BLOCKED` or `FAILED`, stop. On `PLAN`, read `.chatbridge/runs/<taskId>/plan.md`, then run `chatbridge duet begin-execution --task <taskId>` before modifying code.
6. Inspect, edit, test, stage, and commit on the generated task branch. Do not push, merge, open a PR, force-push, or switch to an arbitrary branch. Record tests honestly as `PASS`, `FAIL`, or `NOT_RUN`.
7. With a clean worktree and at least one commit after `BASE_REF`, run `chatbridge duet prepare-review --task <taskId> --tests <status> --output <review-envelope.txt>`. This composes the Frozen M2 provider; do not reproduce its Git checks or push behavior.
8. Run `chatbridge send --message-file <review-envelope.txt>`. Only after a confirmed send, run `chatbridge duet mark-reviewing --task <taskId>`.
9. Run `chatbridge wait`, save the complete response, and ingest it.

Reviewer outcomes:

- `DONE`: stop and summarize implementation, tests, immutable `REVIEW_REF`, and review success.
- `BLOCKED`: show the user's required decision and stop.
- `PLAN`: iteration has advanced and the new plan is durable. Say: `Additional implementation iteration required. Run is durable and ready for continuation.` Stop; M3.0 does not execute iteration 2 automatically.

Stop immediately for invalid C2C, illegal transition, Browser Bridge unavailability, ambiguous send, M2 safety rejection, unexpected branch, or dirty-worktree rejection. Never bypass a guard to finish.
