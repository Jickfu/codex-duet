# Discussion V1 contract

Discussion is an optional bounded architecture exchange before the final Planner response. It is not C2C and cannot transition a run to `PLAN`.

Both strict JSON objects bind `taskId`, positive lifecycle `iteration`, `round` from 1 through 3, the selected provider, `taskSpecSha256`, and `requestSha256`. DiscussionControlV1 also binds the immutable interaction policy and, after round one, the prior accepted response fingerprint. DiscussionResponseV1 binds the exact control fingerprint and contains `outcome` plus response text. Valid outcomes are `CONTINUE`, `CONVERGED`, `USER_DECISION_REQUIRED`, and `FAILED`.

`CONTINUE` permits another round only before round 3. `CONVERGED` unlocks final Planner ingestion. `USER_DECISION_REQUIRED` blocks PLANNING. `FAILED` fails the run. Any missing, extra, malformed, stale, cross-task, cross-provider, or fingerprint-mismatched field is rejected before authority is granted.
