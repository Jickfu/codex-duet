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

## Known issues

### ChatGPT tab ambiguity

When multiple ChatGPT tabs exist without an explicit current target, Frozen M1 fails closed with `CHATGPT_TAB_AMBIGUOUS`. This remains a UX/hardening issue; task/conversation binding is a possible future direction. M1 is unchanged by this freeze.

### Skill validator environment

The external Skill validator could not run because the current Python environments lack PyYAML. Repository static Skill tests pass. This was not an M3.0 Desktop E2E blocker, and no Python dependency was installed for the freeze.

## M3 roadmap

| Sub-stage | Scope                                          | Status      |
| --------- | ---------------------------------------------- | ----------- |
| M3.0      | Codex Skill + Single-Round Orchestration       | **FROZEN**  |
| M3.1      | Automatic Multi-Round Review/Fix Loop          | **NEXT**    |
| M3.2      | Recovery / Conversation Binding / UX Hardening | **PLANNED** |

M3 overall remains **IN PROGRESS**. M4, M5, and M6 ownership is unchanged.
