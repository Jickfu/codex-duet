# ADR-019: LOCAL durable lifecycle core

Status: core implemented; production transport/Discussion adapters and CLI pending.

## Authority

`LocalLifecycle` uses the existing shared C2C transition table and `ResponseIngressService`. Its additive `LocalRunV1` is stored at `.chatbridge/runs/<task>/local/run.json`; no frozen GITHUB run schema or state machine is modified. The record binds the TaskSpec, interaction policy, current control bytes, accepted response bytes/hashes, plan and cumulative sequential LOCAL review targets.

Reads revalidate task identity, TaskSpec and target fingerprints, expected control projection, response identities and ordering, plan provenance, iteration and phase relationships. Writes publish via temporary-file rename under the existing task lock. Provider operations retain their separate nested lock namespace.

Initialization requires a matching initialized provider baseline without existing reviews, an unchanged live baseline and the supplied planning gate. Identical restart initialization returns the existing run without resetting in-progress work. Conflicting spec, policy or iteration limit is rejected.

## Gates and transitions

The required `LocalLifecycleGates` dependency must validate durable policy, bound semantics/contracts, completed optional Discussion and the selected transport's exact control-send confirmation. There is no default permissive implementation. Production adapters are not provided in this checkpoint, and no lifecycle CLI is exposed.

An unconfirmed Planner cannot accept a response. Prepared review remains EXECUTED until its exact send is confirmed, then enters REVIEWING. No send or retry is performed by the lifecycle. PLAN ingestion and beginning execution separately verify the live baseline/latest reviewed snapshot named by the run, not a newer provider observation.

The execution intent is persisted before returning EXECUTING. Repeating beginExecution in EXECUTING returns that durable intent rather than resetting the candidate. The core does not run tests or edit code. Preparing review requires the provider's snapshot-bound evidence and produces immutable control bytes. DONE refers to the reviewed snapshot, not later live edits.

## Response and crash recovery

Browser and MCP callers enter `ingest`, which preflights identity, phase and live guards before reserving shared ingress state. The same checks run again under the ingress lock. The internal ingress is private so callers cannot bypass preflight. Exact replay across sources is idempotent; a changed response or a changed historical iteration is rejected.

If provider publication succeeds before the run write, prepareReview reuses the provider's immutable target on retry. If the run write succeeds before ingress becomes ACCEPTED, the recorded control/response identity lets an exact retry complete acceptance without applying the transition again. Invalid preflight does not reserve a response. A failure after PENDING publication remains reserved for the same response and must not be replaced or silently replayed with different bytes.

## Remaining work

Implement concrete selected-Browser and Discussion gate adapters with real durable evidence; wire the core into LOCAL CLI and capability-scoped MCP ingress; verify real-Git lifecycle integration, cancellation/blocked-resume and execution reconciliation semantics; then perform real end-to-end acceptance. Core unit fixtures simulate transport gates and do not constitute Browser acceptance. M4 is not frozen, and M5/public exposure is unchanged.
