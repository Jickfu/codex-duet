# M3 — Durable Desktop Orchestration

M3 overall status: **FROZEN / COMPLETE — REAL DESKTOP E2E PASS**

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

### GITHUB response identity boundary

M3 GITHUB orchestration requires Planner and Reviewer responses to explicitly echo and match durable task/review identity. Generic M0 C2C parsing remains intentionally broader: `EnvelopeSchema`, `parseEnvelope`, serialization, and the state machine continue to permit non-GitHub protocol use. After either raw C2C parsing or canonical `wait --parse` JSON decoding, M3 validates task, mode, repository, task branch, and immutable `BASE_REF` before iteration/state checks or any artifact/run write.

While `REVIEWING`, the response must also match the current iteration's durable `reviewTarget.reviewRef` and test status. This applies equally to `DONE`, `PLAN`, `BLOCKED`, and `FAILED`. A Reviewer `PLAN` advances to iteration `N+1` while continuing to echo the `REVIEW_REF` and test status of review `N`; it never predicts the future ref. Missing values and mismatches use field-specific structured errors. Browser Bridge does not own run authority, enrich parsed output, or repair a response, and both ingest formats enforce identical lifecycle semantics. 15. M3.0 does not implement full `EXECUTING` crash reconciliation.

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

Implementation status: **Complete**

Desktop multi-round E2E: **PASS**

Frozen implementation baseline: `02a3fdb6c35a3766527543bb703b8ac67feeb194`

The multi-round dogfood review refs are immutable acceptance evidence, not the M3.1 implementation baseline.

M3.1 extends the Frozen M1 Browser Control Plane, Frozen M2 GitHub Data Plane, and Frozen M3.0 single-round orchestration. It does not change `BASE_REF` or `REVIEW_REF` semantics, M2 push rules, M1 send/wait behavior, `PLAN → EXECUTING` safety, or the requirement that review send succeeds before `REVIEWING`.

### Multi-round lifecycle

M3.1 continues a valid Reviewer-requested plan without another user prompt:

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

`PREVIOUS_REVIEW_REF` is not a new C2C header. M0 remains frozen. M3.1 places the previous durable review SHA in the `EXECUTED` content while continuing to carry task, iteration, `BASE_REF`, current `REVIEW_REF`, and test status through existing fields. Codex must not infer or invent any SHA.

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

M3.1 preserves evidence for every iteration rather than overwriting the current plan and review target. New runs use a strict, project-scoped, atomically written V2 checkpoint with durable `limits.maxIterations` configuration. The implemented model follows:

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
  limits: { maxIterations: number };
  blockedPhase?: 'PLANNING' | 'EXECUTING' | 'REVIEWING';
  createdAt: string;
  updatedAt: string;
};
```

New artifact writes are iteration-scoped:

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

M3.0 V1 checkpoints remain readable without status-time mutation. The first mutating operation performs a schema-validated V1-to-V2 migration, copies legacy artifacts into iteration-scoped paths without deleting the originals, and writes the V2 checkpoint atomically. If a stopped V1 next-iteration run lacks overwritten prior-plan evidence, migration records that absence explicitly rather than inventing a hash.

### Automatic continuation and stop semantics

After a valid `REVIEWING N → PLAN N+1` ingest, M3.1 reads the durable next plan, begins execution, edits, tests, commits, prepares review through Frozen M2, sends, marks reviewing, receives with `wait --parse`, ingests, and repeats. A next-round plan should describe the prior findings, required corrections, behavior to preserve, necessary tests, and scope boundaries rather than restart the task.

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

M3.1 adds deterministic runaway protection with `--max-iterations`, bounded from 1 through 100 and defaulting to 8. Reaching the budget is never represented as `DONE`: the run remains `REVIEWING`, persists `ITERATION_LIMIT_REACHED` halt evidence, and returns that structured orchestration error. No new C2C task state is added.

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

### Real Desktop automatic multi-round E2E acceptance

M3.1 Desktop Automatic Multi-Round E2E: **PASS**

- Task: `m3-multi-round-dogfood-20260902`
- Task branch: `agent/task-m3-multi-round-dogfood-20260902`
- `BASE_REF`: `02a3fdb6c35a3766527543bb703b8ac67feeb194`
- `REVIEW_REF_1`: `590ae12a8c9f21b8cea19480b7946c6d14fdf4c5`
- `REVIEW_REF_2`: `d99559b03eacff5e6447c95fa77fc12287e29134`
- Iteration 2 delta: `590ae12a8c9f21b8cea19480b7946c6d14fdf4c5..d99559b03eacff5e6447c95fa77fc12287e29134`
- Final formal range: `02a3fdb6c35a3766527543bb703b8ac67feeb194..d99559b03eacff5e6447c95fa77fc12287e29134`
- Test status: iteration 1 `PASS` — 168 of 168; iteration 2 `PASS` — 168 of 168.
- Final durable state: `DONE`, iteration 2.

The real lifecycle completed as:

```text
INIT
→ PLANNING
→ PLAN(1)
→ EXECUTING(1)
→ EXECUTED(1)
→ REVIEWING(1)
→ PLAN(2)
→ EXECUTING(2)
→ EXECUTED(2)
→ REVIEWING(2)
→ DONE(2)
```

Planner and both Reviewer responses used the canonical receive path:

```text
wait --parse
→ validated Envelope JSON
→ duet ingest
```

Iteration 1 review of `BASE_REF..REVIEW_REF_1` confirmed exactly one commit and one tracked acceptance document containing only the title and iteration 1 marker. The Reviewer intentionally returned `STATE: PLAN`, `ITERATION: 2`, rather than `DONE`.

After durable `REVIEWING(1) → PLAN(2)` ingest, the current Codex Desktop Executor continued automatically without another user prompt. It read the durable plan, began execution, added only the requested iteration 2 marker, tested, committed on the same task branch, prepared the next immutable review through Frozen M2, sent it, marked reviewing, waited, and ingested the result. No second Codex agent, Codex CLI, Codex SDK, or Node Executor loop was used. **Automatic continuation: PASS.**

Iteration 2 review first inspected the delta `REVIEW_REF_1..REVIEW_REF_2`, confirming exactly one required line was added while iteration 1 content was preserved. It then inspected the authoritative cumulative range `BASE_REF..REVIEW_REF_2`, confirming exactly two commits, only the acceptance document, the complete required final content, and no M1/M2/M3 implementation changes. The Reviewer returned `STATE: DONE`, `ITERATION: 2`. **Delta review focus: PASS. Formal cumulative review: PASS.**

`git merge-base --is-ancestor REVIEW_REF_1 REVIEW_REF_2` succeeded. The immutable task-level `BASE_REF` remained unchanged, and the previous review SHA came from durable iteration history. Review-ref monotonicity is verified.

Durable evidence was preserved without overwriting earlier rounds:

```text
.chatbridge/runs/m3-multi-round-dogfood-20260902/
  request.md
  iterations/
    1/
      plan.md
      review-envelope.txt
    2/
      plan.md
      review-envelope.txt
```

Both rounds used `duet prepare-review`, which delegated branch safety, clean-worktree enforcement, safe push, remote-SHA verification, and immutable `REVIEW_REF` creation to Frozen M2. Codex did not push directly. No pull request, merge, force-push, or alternate task branch was created. The dogfood branch remains unmerged and must not be deleted; `d99559b03eacff5e6447c95fa77fc12287e29134` remains immutable M3.1 Desktop acceptance evidence.

### M3.1 frozen implementation contract

M3.1 is **Frozen** at implementation baseline `02a3fdb6c35a3766527543bb703b8ac67feeb194`. The frozen contract is:

1. One task has one immutable `BASE_REF` and one task branch.
2. Formal review identity is always `BASE_REF..CURRENT_REVIEW_REF`.
3. For iteration greater than 1, `PREVIOUS_REVIEW_REF..CURRENT_REVIEW_REF` is a delta focus and never replaces the formal range.
4. The previous review ref comes only from durable history, and review refs advance monotonically.
5. Reviewer `PLAN N+1` uses iteration `N+1`; `DONE`, `BLOCKED`, and `FAILED` use the current iteration `N`.
6. A valid `PLAN N+1` continues automatically under the current Codex Desktop Executor without requiring another user prompt.
7. Codex remains the only Executor; deterministic M3 lifecycle authority does not become an Executor loop.
8. V2 checkpoints preserve complete iteration history and iteration-scoped artifacts without overwriting; V1 checkpoints remain compatible.
9. `maxIterations` defaults to 8, accepts 1 through 100, and exhaustion remains `REVIEWING` with durable `ITERATION_LIMIT_REACHED`, never `DONE`.
10. Frozen M2 remains solely responsible for push and ref safety; Frozen M1 carries only compact Browser Control Plane data while source and diffs remain on the GitHub Data Plane.
11. Full `EXECUTING` crash reconciliation and conversation binding remain outside M3.1.

## M3.2 decomposition

M3 is **FROZEN / COMPLETE — REAL DESKTOP E2E PASS**. M3.2 was delivered through independently bounded stages:

| Sub-stage | Scope                                 | Status                                   |
| --------- | ------------------------------------- | ---------------------------------------- |
| M3.2a     | Task ↔ ChatGPT conversation binding   | **FROZEN / DESKTOP E2E PASS**            |
| M3.2b     | `EXECUTING` crash reconciliation      | **FROZEN / REAL DESKTOP CRASH E2E PASS** |
| M3.2c     | Compact Browser Control and Resume UX | **FROZEN / REAL DESKTOP E2E PASS**       |

M3.2a is frozen before M3.2b begins. It changes only deterministic Browser Control Plane routing. Frozen M0 C2C, legacy M1 behavior, M2 Git/ref safety, M3.0, M3.1, review identity, and automatic multi-round execution remain unchanged.

### M3.2a — Task ↔ ChatGPT Conversation Binding

Design status: **Frozen**

Implementation status: **Complete**

Desktop multiple-tab E2E: **PASS**

Overall status: **Frozen**

Frozen implementation baseline: `61f8565dda0ffc6b24c90116b648368afad1da6b`

Historical pre-dogfood baseline: `7d9d31206e699d5a878f40abe23fb1aa1d82412e`. It remains part of the milestone history; real post-freeze Desktop integration testing required the additive corrections recorded below before M3.2a was re-frozen.

Before M3.2a, `.chatbridge/session.json` was the only Browser checkpoint and was workspace-global. Although `SendCheckpointV2` recorded `conversationUrl` and `outgoingUserMessageId`, `runtime()` connected the browser before `wait` read that checkpoint. Both transports could therefore reject multiple ChatGPT tabs before the durable target was available, and another task's send could overwrite the only wait anchor.

M3.2a freezes one durable task ↔ one immutable ChatGPT conversation. It uses a separate strict, atomic, path-safe, project-scoped, gitignored sidecar:

```text
.chatbridge/runs/<taskId>/browser.json
```

The sidecar holds only task ID, validated conversation URL, message IDs, timestamps, and minimal binding state. It is Browser Control Plane metadata, not C2C, CodeProvider, source, `BASE_REF`, or `REVIEW_REF` state. Frozen M3.1 `DuetRunCheckpointV2` remains unchanged.

The public CLI design is additive:

```text
chatbridge send --message-file <path> [--task <taskId>] [--conversation-url <url>]
chatbridge wait --parse [--task <taskId>]
```

`--conversation-url` requires `--task` and is only an explicit bootstrap target for an unbound task. Legacy unscoped calls keep `.chatbridge/session.json` and all Frozen ambiguity behavior.

An unbound first task send uses existing discovery: one eligible tab is reused and multiple tabs return `CHATGPT_TAB_AMBIGUOUS`. A blank `/` route is only a serialized bootstrap surface. After the outgoing message ID is confirmed, the transport waits for a concrete canonical `.../c/<conversation-id>` URL; only then are final reservation, binding, and pending-send identity persisted together. A bound send or wait reads the sidecar before browser connection, then targets exactly that conversation. A missing tab is opened at the exact allowlisted URL in the same authenticated context; failure returns `CHATGPT_CONVERSATION_UNAVAILABLE` without fallback or rebind.

Conversation binding remains immutable through planning, review iterations, reconnect, and process restart. Two non-terminal tasks cannot bind one conversation; implementations must serialize claims and return `CHATGPT_CONVERSATION_ALREADY_BOUND` on conflict. Terminal tasks release the reservation but retain historical binding evidence. Timeout recovery permits only another task-aware wait against the same marker and conversation, never resend.

The Library, Extension/CDP, Playwright CLI, and managed-browser paths share one `BrowserAutomationSession` exact-target contract. A transport that cannot safely implement it fails closed rather than using global selection. Existing `OriginPolicy` remains authoritative and no browser/chat content or authentication material is persisted.

The implementation adds strict `TaskBrowserBindingV1` storage, canonical URL validation, a bounded cross-process bootstrap lock, active/historical reservation checks, pre-send selected identity, exact missing-tab reopen, task-aware CLI composition, and stable Playwright CLI targeting across independent operations. It distinguishes `SEND_OUTCOME_UNKNOWN` from confirmed-side-effect `SEND_CHECKPOINT_PERSIST_FAILED`; neither permits automatic resend. Successful waits retain the pending marker until a later confirmed send atomically replaces it.

The re-frozen implementation quality gate passes 281 of 281 automated tests, including concurrent bootstrap, active and historical reservation behavior, task-scoped isolation, wait-before-connect ordering, timeout and unknown-send recovery, persistence failure, exact Library/CDP routing, missing-tab reopen, Playwright CLI target stability, strict task recovery isolation, post-reservation exact re-pin ordering, send-actionability boundaries, GITHUB response identity, and Frozen legacy regressions.

#### Real Desktop multiple-tab E2E acceptance

Task `m3-conversation-binding-dogfood-20260902` completed on `agent/task-m3-conversation-binding-dogfood-20260902` with lifecycle:

```text
PLANNING → PLAN → EXECUTING → EXECUTED → REVIEWING → DONE
```

The immutable GitHub review range was `7d9d31206e699d5a878f40abe23fb1aa1d82412e..ee0434f86bd8a70bb0aa6703b9ab8457e8793051`; tests were `PASS — 199/199`, and Reviewer returned `DONE` iteration 1 with no findings. The range was exactly one commit ahead with merge base equal to `BASE_REF`, changed only `docs/acceptance/M3-conversation-binding-dogfood.md`, and contained no M1/M2/M3 implementation changes. Frozen M2 performed safe push, remote-SHA verification, and immutable review identity. Codex did not direct-push, create a PR, merge, or force-push. The dogfood branch remains unmerged and must not be deleted; its review ref is immutable acceptance evidence, not the implementation baseline.

The real existing-browser environment used symbolic C1 as the explicit task target and unrelated C2/C3. With all tabs open, first task-aware PLANNING send and bound Planner wait targeted only C1 and never returned `CHATGPT_TAB_AMBIGUOUS`. After `EXECUTED`, manually closing C1 caused the bound review send to reopen exact C1 without another `--conversation-url`, rebind, or fallback. After `REVIEWING`, manually closing C1 again caused task-aware wait to read the durable binding and pending anchor first, reopen exact C1, and receive Reviewer `DONE` without resending the review message.

Conversation identity stability, original `boundAt`, unrelated-tab isolation, task-scoped pending-send replacement, and legacy global SessionStore isolation all passed. The planning marker was atomically replaced by the confirmed review marker, while successful wait preserved that recovery evidence. Public documentation intentionally omits real conversation URLs, message IDs, timestamps, hashes, and unrelated-tab details; those identifiers remain only in local gitignored Browser Control Plane evidence.

#### Frozen M3.2a contract

1. One active durable task binds to one ChatGPT conversation.
2. Binding is Browser Control Plane metadata.
3. Task Browser state lives in `.chatbridge/runs/<taskId>/browser.json`.
4. Task Browser state remains separate from Frozen M3.1 V2 orchestration checkpoints.
5. Task-aware Browser operations read binding before Browser connection.
6. Exact bound identity takes precedence over global tab discovery.
7. Legacy unscoped M1 behavior remains backward compatible.
8. Bootstrap without an explicit target remains fail-closed on ambiguity.
9. Explicit bootstrap uses a validated exact concrete conversation URL; generic/new-chat routes are rejected.
10. Active tasks cannot share the same conversation.
11. `BLOCKED` remains an active reservation.
12. `DONE`, `FAILED`, and `CANCELLED` release exclusive reservation while retaining historical evidence.
13. Historical conversation reuse requires explicit bootstrap.
14. Concrete bootstrap reservation happens before send; blank new-chat bootstrap holds the project lock and reserves only its post-send concrete identity.
15. Project-wide filesystem serialization prevents concurrent double-binding.
16. Task-aware send exact-pins the selected conversation before login, prepare, and send.
17. Task-aware Playwright CLI recovery is strict to the exact prepared conversation.
18. Legacy unscoped M1 retains Frozen broad send recovery.
19. A missing bound tab reopens only the exact conversation.
20. A missing or unavailable exact conversation never falls back to another ChatGPT tab.
21. Confirmed-send checkpoint persistence failure never authorizes resend.
22. `SEND_OUTCOME_UNKNOWN` never authorizes resend.
23. Successful wait preserves pending-send recovery evidence until a later confirmed send replaces it.
24. Task-aware and legacy SessionStore paths remain isolated.
25. Conversation URL remains immutable unless a future explicit rebind workflow is introduced.
26. No C2C schema changes.
27. No CodeProvider changes.
28. No M2 review identity changes.
29. No M3.1 automatic-loop changes.
30. No Browser DOM, history, or storage is persisted in task binding.

#### Post-freeze integration corrections and re-freeze

Real Desktop dogfood after the historical freeze exposed three integration defects. They were corrected without changing the M3.2a ownership boundary:

1. **First-send blank-chat identity stabilization.** The outgoing message ID could become observable before the SPA changed generic `/` into `/c/<id>`, allowing `/` to be persisted too early. Generic `/` is now a bootstrap surface only. Library and Playwright CLI confirmation wait for a validated concrete durable identity after the outgoing ID; a confirmed send whose identity or checkpoint cannot be established returns `SEND_CHECKPOINT_PERSIST_FAILED` and never authorizes resend.
2. **Send actionability boundary.** The old path could enter `COMMIT_ATTEMPTED` before the actual send action was executable. The frozen order is now `fill → bounded readiness → trial actionability → COMMIT_ATTEMPTED → actual send → COMMITTED`. `CHATGPT_SEND_NOT_READY` is a deterministic `PRE_COMMIT` failure.
3. **M3 GITHUB response identity.** Generic M0 C2C remains unchanged. M3 GITHUB Planner and Reviewer responses must echo and match durable `MODE`, `REPOSITORY`, `TASK_BRANCH`, and `BASE_REF`; Reviewer responses additionally echo `REVIEW_REF` and `TEST_STATUS`. A multi-round `PLAN N+1` identifies the just-completed review N ref/status.

The replacement frozen implementation baseline is `61f8565dda0ffc6b24c90116b648368afad1da6b`. The earlier `7d9d31206e699d5a878f40abe23fb1aa1d82412e` remains the historical pre-correction baseline.

#### Real Desktop blank-new-chat acceptance

Task `m3-blank-chat-binding-dogfood-3-20260902` completed on `agent/task-m3-blank-chat-binding-dogfood-3-20260902` with lifecycle:

```text
PLANNING → PLAN → EXECUTING → EXECUTED → REVIEWING → DONE
```

Its immutable GitHub range was `61f8565dda0ffc6b24c90116b648368afad1da6b..03524ac61d120ee0426d9924b937fda109e77d21`; tests were `PASS — 281/281`, and Reviewer returned `DONE` iteration 1. Frozen M2 safely published the immutable review ref. The range adds only `docs/acceptance/M3-blank-chat-binding-dogfood.md` and contains no implementation change.

The Browser lifecycle passed `GENERIC_NEW_CHAT → first implicit send → concrete durable conversation identity → Planner wait on the same identity → Review send on the same identity → Reviewer wait on the same identity`. Generic `/` was never persisted; binding identity and `boundAt` remained unchanged; the pending marker was replaced correctly; legacy SessionStore remained unchanged; and there was no rebind, resend, ambiguity, or conversation-unavailable result.

The review ref `03524ac61d120ee0426d9924b937fda109e77d21` is immutable acceptance evidence, not an implementation baseline. Its task branch remains unmerged and must not be deleted, consistent with earlier M2/M3 acceptance-branch policy. Public documentation omits the actual ChatGPT conversation URL, conversation ID, message IDs, timestamps, and local profile data. Failed pre-PASS dogfood evidence remains available locally in gitignored `.chatbridge` state without publishing private metadata.

Library and Playwright CLI use a bounded `[A-Za-z0-9_-]+` segment in `.../c/<conversation-id>`; wrong origins, credentials, encoded path ambiguity, traversal, and generic routes fail closed. Existing bound identity remains immutable, explicit `/` bootstrap is rejected, and final blank-chat reservation occurs inside the existing project lock. Strict process-timeout recovery remains exact-only and may conservatively return `SEND_OUTCOME_UNKNOWN`. M3.2b semantics remain unchanged; ADR-015 later reframes M3.2c around Compact Browser Control and Resume UX.

The complete decision, alternatives, lifecycle, multiple-task example, privacy boundary, and implementation constraints are frozen in [ADR-013](../adr/ADR-013-task-conversation-binding.md).

M3.2a does not implement `EXECUTING` crash reconciliation; `EXECUTING → EXECUTION_RECOVERY_REQUIRED` remains unchanged. Explicit rebind UX, cleanup, historical binding management, enhanced diagnostics, and recovery UI remain M3.2c work. LOCAL MCP and M4 are out of scope.

### M3.2b — EXECUTING Crash Reconciliation

Design status: **Frozen**

Implementation status: **Complete**

Real Desktop crash E2E: **PASS**

Crash A preserved dirty bytes and resumed `WORKTREE_IN_PROGRESS`. Crash B adopted `CURRENT_ITERATION_M2_PREPARED` into `EXECUTED` without a second prepare or push. Immutable acceptance artifact `3a29c6ddf7bea6723dcc08131793025d484b9eeb` contains exactly the required acceptance file. The later Reviewer Browser transport failure is outside M3.2b acceptance.

M3.2b replaces blind `EXECUTION_RECOVERY_REQUIRED` handling with deterministic local reconciliation. It does not add a `RECOVERING` C2C state, change `TaskState`, upgrade Frozen `DuetRunCheckpointV2`, alter ADR-012 review identity, duplicate Frozen M2, modify M3.2a conversation binding, or change the Codex sole-Executor rule.

Its implementation milestone commit remains `c487a133e36552ee6448c4d89fd8c9081899ce7f`. The successful Crash A/B acceptance used the then-current main HEAD as `BASE_REF`, not the older milestone commit. Failed historical task `m3-execution-recovery-dogfood-20260902` remains preserved and must not be resumed.

Each iteration records an immutable execution baseline and optional exact-HEAD test evidence in:

```text
.chatbridge/runs/<taskId>/iterations/<N>/execution.json
```

Iteration 1 uses task `BASE_REF`; iteration N > 1 uses `PREVIOUS_REVIEW_REF`. Formal review remains cumulative `BASE_REF..CURRENT_REVIEW_REF`. The strict, atomic, gitignored sidecar records only task/iteration identity, plan hash, task branch, baseline full SHA, start time, and optional `PASS|FAIL|NOT_RUN` evidence bound to a full SHA. It stores no source, diff text, logs, environment dump, secrets, or arbitrary external-effect journal.

Crash-safe begin ordering is inspect and validate baseline, atomically write/reuse matching execution evidence, persist `EXECUTING`, return success, then allow Codex to edit. Preconditions are exact task branch, `HEAD == EXECUTION_BASE_REF`, clean conflict-free worktree, and valid current plan hash. Torn sidecar-before-state writes are reusable only on exact identity match. Legacy `EXECUTING` tasks without the sidecar return `LEGACY_EXECUTION_RECOVERY_REQUIRED`; no evidence is invented.

The public primitives are:

```text
chatbridge duet reconcile-execution --task <taskId>
chatbridge duet record-tests --task <taskId> --status PASS|FAIL|NOT_RUN
```

The implementation adds strict `ExecutionCheckpointV1` storage, atomic iteration-scoped persistence, exact durable plan verification, a read-only conflict-aware Git inspector, cross-process task-operation locking, crash-safe begin ordering, HEAD-bound test recording, prepare-review evidence enforcement, compact reconciliation output, and Frozen M2 adoption through read-only `status()` with no repush. The automated quality gate passed 224 of 224 tests before the independent real Desktop Crash A/B acceptance.

A read-only Git inspector classifies branch, full `HEAD`, ancestry, worktree/conflict metadata, sidecar evidence, and Frozen M2 status. It never checks out, resets, cleans, stashes, commits, or pushes. One task's begin, record-tests, reconcile, and prepare-review operations require cross-process-safe serialization.

Reconciliation freezes these actions:

- `BASELINE_CLEAN`: no Git-visible workspace execution effect; resume the same durable PLAN, while external effects remain unverified.
- `WORKTREE_IN_PROGRESS`: preserve dirty work and continue from existing state; never discard or replay the PLAN from the beginning.
- `COMMITTED_CLEAN`: adopt existing descendant commits rather than recreate edits.
- `TEST_EVIDENCE_REQUIRED`: preserve committed work and obtain honest evidence when none exists or its `HEAD` is stale.
- `READY_FOR_PREPARE_REVIEW`: exact-current-HEAD evidence exists; do not replay edits or rerun tests merely because of restart.
- `CURRENT_ITERATION_M2_PREPARED`: conclusively completed Frozen M2 work may be adopted into `EXECUTED` without another push.

`record-tests` is allowed only during `EXECUTING` on the correct clean, conflict-free task branch with a `HEAD` descended from the iteration execution base. Evidence is valid only for that exact full SHA. Existing `prepare-review --tests` remains compatible and must agree with durable evidence when present.

M2 adoption is valid only when repository and branch identity, full review SHA, test status, execution-base ancestry, previous-review monotonicity, clean/conflict-free worktree, and `current HEAD == M2.reviewRef` all agree. For later iterations, `M2.reviewRef` must differ from the current execution base so prior-iteration evidence cannot be mistaken for current preparation. Adoption reconstructs the deterministic review envelope and advances existing `EXECUTING → EXECUTED`; it never repushes. A local commit after M2 preparation is divergence, not adoptable evidence.

Wrong or detached branch, conflicts, non-descendant history, baseline/plan/iteration mismatch, or inconsistent M2 identity fails closed. Dirty work is preserved. PASS is never inferred. M3.2b proves Git-visible state, explicit test evidence, and Frozen M2 evidence only; database, deployment, remote API, publishing, cloud, and arbitrary shell side effects remain `UNVERIFIED` and outside exactly-once guarantees.

The completed acceptance covered a real termination after an uncommitted edit and another after Frozen M2 completion but before M3 persistence. M3.2c changes do not require repeating Crash A/B.

The authoritative decision is [ADR-014](../adr/ADR-014-executing-crash-reconciliation.md). M3.2c and M4 remain out of scope.

### M3.2c — Compact Browser Control and Resume UX

Status: **FROZEN / REAL DESKTOP E2E PASS**

Frozen implementation baseline: `61d08dd77a7b1873cc11658535a42c72cc86d56f`

M3.2c freezes Compact C2C, immutable local `TaskSpecV1` authority, Planner and Reviewer repository contracts, the 8192 UTF-8 byte complete-control limit and deterministic oversized pre-commit rejection, `TaskContextV1` fingerprint pinning, torn-init Compact recovery, named Playwright CLI session reuse, bounded channel-CDP authorization, actionable send selection, exact ambiguous-send recovery, compatibility with task-scoped conversation binding, and the real multi-round Reviewer/Fix lifecycle. Arbitrary-size Browser composer transport, 24K payload support, automatic conversation rebind, attachments, repository archives or diffs over Browser, LOCAL MCP, and broad packaging/browser compatibility remain non-goals.

#### Real Desktop Compact C2C acceptance

- Task: `m3-compact-control-dogfood-20260902`
- `BASE_REF`: `61d08dd77a7b1873cc11658535a42c72cc86d56f`
- Iteration 1 `REVIEW_REF`: `d5aca830e726c342eb6ed9afeed2b5d6961c976a`
- Final iteration 2 `REVIEW_REF`: `c42122044236e7878e69e48ca3c2273eaf81115e`
- Final state: `DONE` iteration 2; exact-HEAD quality evidence: `PASS` — 338 of 338 tests.
- Compact controls: Planner 2745 bytes; Reviewers 559 and 781 bytes.
- Bootstrap: the public zero-candidate path created a blank ChatGPT surface, confirmed one compact send, stabilized a concrete conversation identity, and persisted the task binding without an explicit URL, private DOM inspection, or manual send.
- Review: iteration 1 found a genuine terminal-LF mismatch; automatic continuation changed only that byte-level condition, and iteration 2 approved the cumulative immutable range.
- Session: final health validation reused the same named CLI session with zero new attach, detach, or authorization operations.

The raw request was not duplicated wholesale into the Planner control. The exact-byte fixture intentionally skipped Prettier write because formatting would have violated its authoritative no-terminal-LF literal; lint, typecheck, tests, build, and diff-check passed. The dogfood task branch remains unmerged, and its document is not part of the implementation branch.

## Known issues

### ChatGPT tab ambiguity

When multiple ChatGPT tabs exist without an explicit current target, Frozen M1 fails closed with `CHATGPT_TAB_AMBIGUOUS`. M3.2a freezes additive deterministic targeting for task-aware operations; unscoped M1 remains unchanged, and broader tab/recovery UX remains M3.2c work.

### Skill validator environment

The external Skill validator could not run because the current Python environments lack PyYAML. Repository static Skill tests pass. This was not an M3.0 Desktop E2E blocker, and no Python dependency was installed for the freeze.

## M3 roadmap

| Sub-stage | Scope                                    | Status                                   |
| --------- | ---------------------------------------- | ---------------------------------------- |
| M3.0      | Codex Skill + Single-Round Orchestration | **FROZEN**                               |
| M3.1      | Automatic Multi-Round Review/Fix Loop    | **FROZEN / DESKTOP E2E PASS**            |
| M3.2a     | Task ↔ ChatGPT Conversation Binding      | **FROZEN / DESKTOP E2E PASS**            |
| M3.2b     | `EXECUTING` Crash Reconciliation         | **FROZEN / REAL DESKTOP CRASH E2E PASS** |
| M3.2c     | Compact Browser Control and Resume UX    | **FROZEN / REAL DESKTOP E2E PASS**       |

M3 is **FROZEN / COMPLETE — REAL DESKTOP E2E PASS**. M4 Local Read-Only MCP Data Plane is the next planned milestone; M5 and M6 ownership is unchanged.
