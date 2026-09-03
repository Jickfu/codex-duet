# ADR-023: LOCAL BLOCKED clarification and replanning

Status: user-approved semantics; M4 implementation, not a freeze.

## Decision

An explicit user clarification may resume the same BLOCKED task by appending an immutable decision record and preparing a new Planner control. Original TaskSpec, BLOCKED responses, review targets and ingress records remain unchanged. The new Planner response must be confirmed and accepted before execution. A decision that changes scope or requirements requires a new task instead.

`local resume-blocked` requires the blocked control SHA-256, a decision file and explicit `--scope-unchanged`. That flag records the caller's assertion; software cannot prove the natural-language decision came from the user or is semantically within scope. The caller must obtain a real user decision. Planner instructions retain TaskSpec authority and require BLOCKED if clarification conflicts with scope, acceptance criteria, exact literals or protocol requirements.

## Identity and sequencing

Each LOCAL-only decision record binds exact decision text, task/TaskSpec, sequence, prior decision hash, blocked control and response hashes, the original blocking explanation, planning iteration/snapshot and timestamp. Its self-hash commits those fields. Control identity binds the complete decision-chain digest. Both subsequent Planner and Reviewer controls carry the clarification history and blocking explanations, without relying on conversation memory; response identity must echo that digest. Existing controls without decisions remain byte-compatible.

Planner blocking consumes no execution iteration. Reviewer blocking at iteration N replans at N+1 against the exact reviewed snapshot. Review history remains sequential; replanning does not manufacture a review target. Execution limits still apply. New Planner responses have no TEST_STATUS and can only be PLAN, BLOCKED or FAILED; they cannot grant DONE based on the old review.

## Durability and safety

The decision append and replacement current-control pointer are published together in the LOCAL run checkpoint under the shared task lock. Readers reconstruct the chronological response/decision/review sequence and reject mismatched hashes, provenance, ordering, snapshots, controls or plan authority, including cancelled runs. There is no separate partially published decision artifact.

Identical retries name the original blocked control and preserve timestamp/control bytes. They return current run status without consuming a later BLOCKED or reviving a terminal run. Different text for the same blocked control is refused. Historical accepted responses retain first-response-wins and exact replay semantics; new control bytes create a distinct ingress and Browser operation identity. The existing selected-provider confirmation and response gates remain required.

Resume checks live state against the baseline/latest reviewed snapshot. Drift, stale control identity, scope-change assertion, iteration exhaustion or compact-envelope overflow fail before publication. Decisions are bounded to 100 records, each decision text to 4096 characters, and every complete control retains the 8192 UTF-8 byte limit; no truncation or silent history removal is allowed.

Once a LOCAL lifecycle exists, `project-control` refuses to regenerate a stateless projection. Use the exact `control` returned by `run-status` or the lifecycle operation, so accepted clarification identity cannot be accidentally omitted.

No task cancellation, workspace edits, tests, Browser sends, provider changes, baseline reset or new-task creation are performed by resume. Frozen GITHUB schemas, C2C/1 and the shared transition table remain unchanged. Pre-run Discussion USER_DECISION_REQUIRED is a separate advisory protocol and is not resumed by this command. Public transport and remote exposure remain M5.
