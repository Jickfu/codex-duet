# M3 — Durable Desktop Orchestration

M3 overall status: **IN PROGRESS**

## M3.0 — Single-Round Orchestration

Status: **Frozen**

Frozen implementation baseline: `c7cec37f28f80a0dca38b34105aac828e8dd69e2`

The documentation-only dogfood `REVIEW_REF` is acceptance evidence, not the M3.0 implementation baseline.

## Frozen contract

1. Codex Desktop is the outer orchestrator.
2. Codex is the only workspace Executor.
3. ChatGPT Web acts only as Planner, Architect, and Reviewer.
4. M3 communicates with ChatGPT through the Frozen M1 Browser Control Plane.
5. The canonical Planner and Reviewer receive path is `chatbridge wait --parse` → validated Envelope JSON → `chatbridge duet ingest`.
6. Raw C2C ingest remains available only as a compatibility and diagnostics path with identical lifecycle semantics.
7. M3 lifecycle enforcement reuses the shared `assertTransition` state machine.
8. Codex must not modify the workspace before the durable `PLAN → EXECUTING` transition.
9. M3 does not duplicate Frozen M2 Git push or ref-safety logic.
10. Frozen M2 authoritatively creates and verifies immutable `BASE_REF..REVIEW_REF` review identity.
11. A run enters `REVIEWING` only after the review envelope is confirmed sent.
12. A `REVIEWING` Browser wait timeout does not authorize review-message replay or Executor side-effect replay.
13. Durable `REVIEWING` permits a safe retry of wait and ingest against the existing send checkpoint.
14. If the M3.0 Reviewer returns a new `PLAN`, M3 persists the next iteration but does not execute it automatically.
15. M3.0 does not implement full `EXECUTING` crash reconciliation.

M3.1 must extend these contracts rather than redesign the proven single-round path.

## Real Desktop single-round E2E acceptance

M3.0 Desktop Single-Round E2E: **PASS**

- Task: `m3-single-round-dogfood-2-20260902`
- Task branch: `agent/task-m3-single-round-dogfood-2-20260902`
- Acceptance range: `c7cec37f28f80a0dca38b34105aac828e8dd69e2..bfad099a9fd0474881c6e772363fe3b392f57860`
- `BASE_REF`: `c7cec37f28f80a0dca38b34105aac828e8dd69e2`
- `REVIEW_REF`: `bfad099a9fd0474881c6e772363fe3b392f57860`
- Test status: `PASS` — 142 of 142 tests passed.
- Final durable state: `DONE`.

The real lifecycle completed as:

```text
PLANNING
→ PLAN
→ EXECUTING
→ EXECUTED
→ REVIEWING
→ DONE
```

The Planner path verified:

```text
Codex Desktop
→ duet init
→ Frozen M2 creates task context
→ Frozen M1 sends PLANNING
→ ChatGPT Web reads GitHub BASE_REF
→ returns PLAN
→ wait --parse
→ validated Envelope JSON
→ duet ingest
→ durable PLAN
→ begin-execution
→ EXECUTING
```

Codex modified the workspace only after `PLAN → EXECUTING`. As the sole Executor, it added only the requested acceptance document, changed no M1/M2/M3 implementation, ran 142 tests successfully, and committed on the generated task branch. It did not push directly, create a pull request, or merge.

`duet prepare-review` composed Frozen M2 to verify the clean worktree and task branch, safely push, verify the remote SHA, and freeze `REVIEW_REF`.

ChatGPT Web reviewed the immutable GitHub Data Plane range and confirmed:

- exactly one commit ahead;
- merge base equal to `BASE_REF`;
- exactly one changed tracked file;
- only `docs/acceptance/M3-single-round-dogfood.md` was added;
- no M1, M2, or M3 implementation changes; and
- review passed with no findings.

The Reviewer returned `STATE: DONE` through the same canonical receive path:

```text
wait --parse
→ validated Envelope JSON
→ duet ingest
→ durable DONE
```

The dogfood task branch is intentionally not merged or deleted. Its remote `REVIEW_REF` remains immutable acceptance evidence, consistent with the M2 dogfood branch policy.

## M3.0 recovery acceptance

The first Reviewer wait returned `BRIDGE_TIMEOUT` after the review envelope had been confirmed sent and the run had durably entered `REVIEWING`. Recovery did not resend the review envelope, repeat `prepare-review`, commit, push, initialize, or replay Executor work. It followed:

```text
REVIEWING
→ retry wait --parse against the existing send checkpoint
→ existing DONE response
→ validated Envelope JSON
→ duet ingest
→ DONE
```

This verifies that a Browser wait timeout does not authorize message replay or Executor side-effect replay, while durable `REVIEWING` supports safe wait/ingest recovery.

## M3.1 — Multi-Round Contract Design

Design status: **Frozen**

Implementation status: **NEXT**

M3.1 extends the Frozen M1 Browser Control Plane, Frozen M2 GitHub Data Plane, and Frozen M3.0 single-round orchestration. It does not change `BASE_REF` or `REVIEW_REF` semantics, M2 push rules, M1 send/wait behavior, `PLAN → EXECUTING` safety, or the requirement that review send succeeds before `REVIEWING`.

### Multi-round lifecycle

M3.1 will continue a valid Reviewer-requested plan without another user prompt:

```text
PLANNING
→ PLAN #1
→ EXECUTING
→ EXECUTED
→ REVIEWING
  ├─ DONE
  ├─ BLOCKED
  ├─ FAILED
  └─ PLAN #2
     → EXECUTING
     → EXECUTED
     → REVIEWING
       └─ PLAN #3
          → ...
```

This is normal multi-round continuation only. Full `EXECUTING` crash reconciliation remains M3.2 work.

### Review identity

One task has one immutable `BASE_REF`, captured by Frozen M2 at initialization. Every iteration stays on the same generated task branch. A previous `REVIEW_REF` never becomes a new `BASE_REF`.

For iteration `N`, the formal and authoritative review identity is cumulative:

```text
BASE_REF..CURRENT_REVIEW_REF
```

For iteration greater than 1, the previous reviewed SHA adds a delta focus:

```text
PREVIOUS_REVIEW_REF..CURRENT_REVIEW_REF
```

The Reviewer first inspects this delta to understand the correction and detect regressions, then validates the cumulative formal range to approve the task as a whole. The delta is an efficiency hint, not a correctness identity.

`PREVIOUS_REVIEW_REF` is not a new C2C header. M0 remains frozen. M3.1 will place the previous durable review SHA in the `EXECUTED` content while continuing to carry task, iteration, `BASE_REF`, current `REVIEW_REF`, and test status through existing fields. Codex must not infer or invent any SHA.

### Iteration and commit semantics

Iteration numbering binds `PLAN #N`, execution `#N`, `REVIEW_REF_N`, and review `#N`:

- `DONE`, `BLOCKED`, and `FAILED` from review use `ITERATION: N`.
- A Reviewer-requested correction uses `STATE: PLAN` with `ITERATION: N+1`.
- M3.1 continues that durable next plan automatically when all deterministic guards pass and no user decision is required.

All rounds use the same `agent/task-<taskId>` branch. An iteration may contain one or more normal commits. Frozen M2 must still verify that the current local `HEAD` is safely pushed and that the remote task-branch SHA equals `REVIEW_REF_N`.

Review refs must be monotonic:

```text
BASE_REF
  ↓
REVIEW_REF_1
  ↓
REVIEW_REF_2
  ↓
REVIEW_REF_3
```

Each prior review ref must be an ancestor of the next. History rewrite, reset behind a reviewed ref, force-push, or divergence from reviewed history is forbidden. M3.1 records and checks sequence consistency at the orchestration layer without duplicating M2 transport or push safety.

### Durable history target

M3.1 must preserve evidence for every iteration rather than overwrite the current plan and review target. The target versioned model is conceptually:

```ts
type DuetIterationRecord = {
  iteration: number;
  plan: { sha256: string };
  reviewTarget?: GitHubReviewTarget;
};

type DuetRunCheckpointV2 = {
  version: 2;
  taskId: string;
  mode: 'GITHUB';
  iteration: number;
  state: TaskState;
  context: GitHubContextRef;
  request: { sha256: string };
  iterations: DuetIterationRecord[];
  blockedPhase?: 'PLANNING' | 'EXECUTING' | 'REVIEWING';
  createdAt: string;
  updatedAt: string;
};
```

The target artifact history is likewise iteration-scoped:

```text
.chatbridge/runs/<taskId>/
  request.md
  iterations/
    1/
      plan.md
      review-envelope.txt
    2/
      plan.md
      review-envelope.txt
```

The implementation must retain M3.0 V1 read compatibility through either V1 reads plus V2 writes or a safe V1-to-V2 migration. It must not mutate the V1 schema in a way that makes existing checkpoints unreadable. The exact migration mechanism is deferred to implementation.

### Automatic continuation and stop semantics

After a valid `REVIEWING N → PLAN N+1` ingest, M3.1 will read the durable next plan, begin execution, edit, test, commit, prepare review through Frozen M2, send, mark reviewing, receive with `wait --parse`, ingest, and repeat. A next-round plan should describe the prior findings, required corrections, behavior to preserve, necessary tests, and scope boundaries rather than restart the task.

The loop stops on:

```text
DONE
BLOCKED
FAILED
CANCELLED
invalid C2C
illegal transition
M1 safety rejection
M2 safety rejection
unexpected branch
dirty worktree
ambiguous send
EXECUTION_RECOVERY_REQUIRED
```

`BLOCKED` always returns control to the user; automation does not make consequential product decisions on the user's behalf.

M3.1 must add deterministic runaway protection with a configurable `maxIterations` safety budget and a recommended default of 8. Reaching the budget must never be represented as `DONE`. The implementation should return a structured `ITERATION_LIMIT_REACHED` orchestration error while preserving the lifecycle state unless the existing state model later justifies a protocol-compatible alternative. This design does not add a new C2C task state.

### Token and data-plane policy

Every round carries enough deterministic identity to avoid relying on conversation memory: task, iteration, immutable `BASE_REF`, current `REVIEW_REF`, previous review SHA in `EXECUTED` content when applicable, and test status. ChatGPT reads code through the GitHub Data Plane. The Browser Control Plane carries compact control data, never diffs or repository content.

### Example

```text
BASE_REF = A

Iteration 1:
  PLAN 1
  Codex commits
  REVIEW_REF_1 = B
  Formal review = A..B
  Reviewer returns PLAN iteration 2

Iteration 2:
  Codex fixes and commits
  REVIEW_REF_2 = C
  Delta focus  = B..C
  Formal review = A..C
  Reviewer returns PLAN iteration 3

Iteration 3:
  Codex fixes and commits
  REVIEW_REF_3 = D
  Delta focus  = C..D
  Formal review = A..D
  Reviewer returns DONE iteration 3
```

The authoritative decision is recorded in [ADR-012](../adr/ADR-012-multi-round-review-identity.md).

## Known issues

### ChatGPT tab ambiguity

When multiple ChatGPT tabs exist without an explicit current target, Frozen M1 fails closed with `CHATGPT_TAB_AMBIGUOUS`. This remains a UX/hardening issue; task/conversation binding is a possible future direction. M1 is unchanged by this freeze.

### Skill validator environment

The external Skill validator could not run because the current Python environments lack PyYAML. Repository static Skill tests pass. This was not an M3.0 Desktop E2E blocker, and no Python dependency was installed for the freeze.

## M3 roadmap

| Sub-stage | Scope                                          | Status                                  |
| --------- | ---------------------------------------------- | --------------------------------------- |
| M3.0      | Codex Skill + Single-Round Orchestration       | **FROZEN**                              |
| M3.1      | Automatic Multi-Round Review/Fix Loop          | **DESIGN FROZEN / IMPLEMENTATION NEXT** |
| M3.2      | Recovery / Conversation Binding / UX Hardening | **PLANNED**                             |

M3 overall remains **IN PROGRESS**. M4, M5, and M6 ownership is unchanged.
