# ADR-012: Multi-Round Review Identity

## Status

Accepted as the M3.1 contract design freeze before implementation.

## Context

M3.0 durably supports a Reviewer returning `PLAN` for the next iteration but intentionally stops instead of executing another round. M3.1 will continue valid review-directed corrections automatically while preserving the Frozen M1 Browser Control Plane, Frozen M2 GitHub Data Plane, and Frozen M3.0 safety ordering.

A multi-round task needs both an efficient way to inspect the latest correction and an authoritative identity for approving the complete task result. It must also preserve one task, one branch, and one immutable initialization base without changing the Frozen C2C/1 header schema.

## Decision

One task has one immutable `BASE_REF`, captured at initialization. It remains unchanged for every iteration and is never replaced by a previous review ref.

For each iteration, the formal and authoritative review identity remains:

```text
BASE_REF..CURRENT_REVIEW_REF
```

For iteration greater than 1, the range:

```text
PREVIOUS_REVIEW_REF..CURRENT_REVIEW_REF
```

is only the per-iteration delta focus. The Reviewer first inspects that delta to evaluate the requested correction and possible regressions, then validates the cumulative formal range to approve the task as a whole.

All iterations use the same generated task branch. Review refs advance monotonically: each previous review ref must be an ancestor of the current review ref. Frozen M2 remains authoritative for local `HEAD`, safe push, and remote-SHA verification; M3.1 records and validates the durable review sequence without duplicating M2 transport safety.

`PREVIOUS_REVIEW_REF` is carried in the `EXECUTED` payload content. It is not added as a C2C header. Every SHA comes from durable M3/M2 state rather than conversation memory or inference.

Reviewer outcomes for review iteration `N` use iteration `N` for `DONE`, `BLOCKED`, or `FAILED`, and iteration `N+1` for a new `PLAN`. M3.1 may automatically continue a valid next plan while all deterministic guards pass, but it must stop for terminal states, user decisions, safety rejections, execution recovery requirements, or its deterministic iteration budget.

## Consequences

- Final approval always covers the complete task implementation, not only its latest fix commit.
- Delta inspection improves review efficiency without weakening the formal correctness identity.
- `BASE_REF` semantics, the C2C/1 schema, M1 send/wait behavior, and M2 push/ref safety remain unchanged.
- Durable state and artifacts must preserve every iteration's plan, review target, and test status.
- M3.0 V1 checkpoints must remain readable through compatibility or safe migration.
- Automatic continuation needs deterministic runaway protection; the recommended default `maxIterations` is 8, and exhaustion must not be reported as `DONE`.
- Full `EXECUTING` crash reconciliation and conversation binding remain M3.2 concerns.
