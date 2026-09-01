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
