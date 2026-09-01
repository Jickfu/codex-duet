# C2C/1 protocol

C2C is a public control protocol, independent of Browser Bridge, Local Bridge, or any provider.

```text
[C2C/1]
TASK: 01JEXAMPLE
ITERATION: 2
STATE: PLAN

PLAN:
Implement the validated change.
```

Every envelope contains protocol version, non-empty task ID, non-negative integer iteration, and state. The payload section name must equal `STATE`. Unknown versions/states, missing fields, mismatched sections, and malformed iteration values are rejected rather than inferred.

States are `INIT`, `PLANNING`, `PLAN`, `EXECUTING`, `EXECUTED`, `REVIEWING`, `DONE`, `BLOCKED`, `FAILED`, and `CANCELLED`. The normal path is:

```text
INIT -> PLANNING -> PLAN -> EXECUTING -> EXECUTED -> REVIEWING
                                              REVIEWING -> PLAN (iterate)
                                              REVIEWING -> DONE
```

Terminal states have no outgoing transitions. In particular, `DONE -> EXECUTING` is invalid. `BLOCKED` may resume into the phase that can make progress. Parsers validate syntax; the state machine separately validates lifecycle transitions.

## M3.1 iteration semantics

M3.1 multi-round orchestration does not change the C2C/1 schema or add headers. Iteration numbering binds `PLAN #N`, execution `#N`, review target `REVIEW_REF_N`, and review `#N`.

While reviewing iteration `N`:

- `DONE`, `BLOCKED`, and `FAILED` responses use `ITERATION: N`.
- A request for another correction uses `STATE: PLAN` and `ITERATION: N+1`.

The task-level `BASE_REF` remains the SHA captured at initialization for every iteration. Formal review identity is always cumulative:

```text
BASE_REF..CURRENT_REVIEW_REF
```

For iteration greater than 1, `PREVIOUS_REVIEW_REF..CURRENT_REVIEW_REF` is a delta inspection focus only. `PREVIOUS_REVIEW_REF` is carried in `EXECUTED` content rather than a new header. The Reviewer inspects the delta first, then validates the cumulative formal range.

Review refs must advance monotonically on the same task branch: every `REVIEW_REF_N` is an ancestor of `REVIEW_REF_N+1`. Durable iteration history, compatibility with M3.0 V1 checkpoints, automatic continuation, and iteration-limit behavior are M3.1 orchestration concerns; they do not alter this protocol schema. See [ADR-012](adr/ADR-012-multi-round-review-identity.md).

## GitHub mode review envelope

An `EXECUTED` GitHub message adds `MODE`, `REPOSITORY`, `TASK_BRANCH`, `BASE_REF`, `REVIEW_REF`, and `TEST_STATUS`. Both refs must be lowercase full 40-character SHAs; moving refs and short SHAs are rejected. These mode-specific requirements are enforced by the central protocol schema. A `PLAN` message does not require a review ref.

```text
[C2C/1]
TASK: demo
ITERATION: 1
STATE: EXECUTED
MODE: GITHUB
REPOSITORY: owner/repository
TASK_BRANCH: agent/task-demo
BASE_REF: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
REVIEW_REF: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
TEST_STATUS: PASS

EXECUTED:
Review the implementation using the GitHub data plane.
Review exactly BASE_REF..REVIEW_REF.
Do not review a moving branch head.
```

For a later iteration, the existing `EXECUTED` content may additionally identify the durable previous reviewed SHA and instruct the Reviewer to inspect that delta before validating the cumulative formal range. No `PREVIOUS_REVIEW_REF` header is introduced.
