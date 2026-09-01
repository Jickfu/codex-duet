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
