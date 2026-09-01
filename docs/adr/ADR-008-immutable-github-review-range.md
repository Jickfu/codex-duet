# ADR-008: GitHub review uses an immutable commit range

## Status

Accepted for M2.

## Decision

Every GitHub review instruction identifies both ends of the review range with strict, lowercase, full 40-character commit SHAs: `BASE_REF..REVIEW_REF`.

`BASE_REF` is captured at task initialization. `REVIEW_REF` is accepted only after the task branch is pushed and the remote branch SHA is independently queried and proven equal to local `HEAD`.

## Rationale

A range such as `main..task-branch` is time-dependent. Either branch can advance after the instruction is produced, so two reviewers can unknowingly inspect different code. Branch names, tags, `HEAD`, remote-tracking names, and short SHAs are therefore not formal review references.

Immutable endpoints make a review reproducible, auditable, and independent of later default-branch or task-branch movement. The branch remains useful for safe transport; it is not the durable identity of the review.

## Consequences

- Every formal GitHub review target contains two validated full SHAs.
- The task base does not silently update after initialization.
- Push success alone is insufficient; remote SHA equality is mandatory.
- A later implementation creates a new `REVIEW_REF` while retaining the original `BASE_REF` unless a new task is explicitly initialized.
