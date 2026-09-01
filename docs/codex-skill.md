# Codex Desktop Skill

Status: **M3.0, M3.1, and M3.2a Frozen**

Desktop E2E: **PASS**

M3.1 Desktop multi-round E2E: **PASS**

M3.2a Desktop multiple-tab E2E: **PASS**

## Dogfood regression note

**M3.0 Desktop E2E finding #1:** the first real Desktop dogfood attempt exposed a contract mismatch between M1 `wait --parse` Envelope JSON and M3's raw-C2C-only ingest boundary. M3 now accepts both the canonical parsed JSON path and raw C2C compatibility path through the same protocol schema and lifecycle validation. That first attempt was not an E2E pass; the successful fresh-task acceptance is recorded in [the M3 milestone](milestones/M3-durable-orchestrator.md).

## Location and discovery

The canonical repository Skill is `.agents/skills/codex-duet/SKILL.md`. Open this repository as the Codex Desktop workspace so repo-local skills can be discovered, then explicitly invoke it. If the installed Codex Desktop release does not discover repo-local skills, use that release's supported Skills import/install UI to import the `codex-duet` folder; do not assume or hard-code a user profile directory.

Examples:

```text
使用 codex-duet，帮我新增一个用于 M3.0 dogfood 的无害文档。
用 codex-duet 实现这个 GitHub 模式任务。
Use codex-duet to implement this change.
Ask ChatGPT to plan and review this task with codex-duet.
```

Ordinary code questions do not trigger this side-effecting workflow. The Skill creates a task branch, directs Codex to commit, and delegates the verified push to the Frozen M2 provider.

## What happens

The Skill asks ChatGPT Web for a PLAN through the Frozen Browser Bridge before code changes. Its canonical receive path is `chatbridge wait --parse`, save the complete validated Envelope JSON, then `chatbridge duet ingest`; raw C2C remains accepted for compatibility and diagnostics. The current Codex Desktop agent performs the implementation as the only Executor. `chatbridge duet prepare-review` composes the Frozen GitHub provider to produce and push an immutable `BASE_REF..REVIEW_REF`; ChatGPT then reviews that exact range.

No Codex CLI, Codex SDK, secondary Codex agent, daemon, or automated Codex Desktop UI control is required.

## Windows Desktop acceptance

The real M3.0 single-round acceptance completed with task `m3-single-round-dogfood-2-20260902`, immutable range `c7cec37f28f80a0dca38b34105aac828e8dd69e2..bfad099a9fd0474881c6e772363fe3b392f57860`, 142 of 142 tests passing, and final durable state `DONE`. Planner and Reviewer both used `wait --parse` → validated Envelope JSON → `duet ingest`. Reviewer recovery also confirmed that a Browser wait timeout does not authorize message replay.

The repeatable manual acceptance procedure is:

1. Start from a clean repository with a supported GitHub `origin` and an authenticated existing browser/session.
2. Open the repository in Codex Desktop and issue the harmless docs-only example above.
3. Confirm the visible lifecycle is `PLANNING → PLAN → EXECUTING → EXECUTED → REVIEWING → DONE`.
4. Confirm Codex did not push directly, the remote task-branch SHA equals `REVIEW_REF`, and review used the immutable range.
5. Confirm `.chatbridge/runs/<taskId>.json` supports a restart at each documented safe state.

The dogfood task branch remains unmerged and its `REVIEW_REF` remains immutable acceptance evidence.

The real M3.1 automatic multi-round acceptance completed with task `m3-multi-round-dogfood-20260902` on the single task branch `agent/task-m3-multi-round-dogfood-20260902`. Its immutable task base was `02a3fdb6c35a3766527543bb703b8ac67feeb194`; review refs advanced monotonically from `590ae12a8c9f21b8cea19480b7946c6d14fdf4c5` to `d99559b03eacff5e6447c95fa77fc12287e29134`.

The first review deliberately returned `PLAN` iteration 2. After canonical `wait --parse` → validated Envelope JSON → `duet ingest`, the current Codex Desktop Executor automatically continued without another user prompt. The second review inspected delta `590ae12a8c9f21b8cea19480b7946c6d14fdf4c5..d99559b03eacff5e6447c95fa77fc12287e29134`, then approved formal range `02a3fdb6c35a3766527543bb703b8ac67feeb194..d99559b03eacff5e6447c95fa77fc12287e29134` as `DONE` iteration 2. Both iterations passed 168 of 168 tests. Iteration-scoped plan and review artifacts remained in durable history, and Frozen M2 performed both safe pushes. The dogfood branch remains unmerged as immutable acceptance evidence.

The real M3.2a multiple-tab acceptance completed with task `m3-conversation-binding-dogfood-20260902`, immutable range `7d9d31206e699d5a878f40abe23fb1aa1d82412e..ee0434f86bd8a70bb0aa6703b9ab8457e8793051`, 199 of 199 tests passing, and final durable state `DONE` iteration 1. Explicit C1 bootstrap, bound Planner wait, and exact missing-tab reopen for review send and Reviewer wait all passed while unrelated C2/C3 remained open. The task binding and original `boundAt` stayed stable, pending-send replacement remained task-scoped, and the legacy global SessionStore stayed isolated. The dogfood branch remains unmerged; public documentation deliberately omits all real conversation and message identifiers.

## Roadmap

- M3.0 Single-Round Orchestration: **Frozen**.
- M3 overall: **IN PROGRESS**.
- M3.1 Automatic Multi-Round Review/Fix Loop: **Frozen / Desktop E2E PASS**.
- M3.2a Task ↔ ChatGPT Conversation Binding: **Frozen / Desktop E2E PASS**.
- M3.2b `EXECUTING` Crash Reconciliation: **DESIGN FROZEN / IMPLEMENTATION NEXT**.
- M3.2c Resume / Browser UX Hardening: **PLANNED**.

M3.1 builds on the frozen single-round contract. One task keeps one branch and one immutable task-level `BASE_REF`; every formal review is cumulative `BASE_REF..CURRENT_REVIEW_REF`, while `PREVIOUS_REVIEW_REF..CURRENT_REVIEW_REF` is only a delta focus. A valid Reviewer `PLAN` for iteration `N+1` continues automatically under the current Codex Desktop Executor, subject to deterministic guards and a configurable iteration limit. M3.1 does not add a Node agent loop or change M4/M5/M6 ownership. See [the M3 milestone](milestones/M3-durable-orchestrator.md) and [ADR-012](adr/ADR-012-multi-round-review-identity.md).

New tasks default to eight iterations. `chatbridge duet init --max-iterations <n>` may set a durable limit from 1 through 100. Reaching it leaves the run in `REVIEWING` with `ITERATION_LIMIT_REACHED`; the Skill stops and reports the halt rather than continuing or treating it as success.

## Troubleshooting

- Run `chatbridge browser doctor` when browser prerequisites fail.
- Prefer an existing authenticated browser/session. If Chrome asks for remote-debugging authorization, approve it explicitly and retry; this is not a task failure.
- An ambiguous `send` result, invalid C2C response, dirty worktree, unexpected branch, or M2 safety rejection is a stop condition.
- `EXECUTION_RECOVERY_REQUIRED` means M3.0 cannot safely infer which plan steps already ran. Inspect and reconcile manually rather than replaying the plan.
- At `EXECUTED`, resend the durable review envelope path returned by `chatbridge duet status`, then mark reviewing only after send succeeds.
- At durable `REVIEWING`, a Browser wait timeout permits retrying `wait --parse` and ingest against the existing send checkpoint; it does not permit resending the review envelope or replaying Executor side effects.
- Multiple ChatGPT tabs without an explicit current target fail closed with `CHATGPT_TAB_AMBIGUOUS`; M3.2a freezes deterministic task/conversation targeting while preserving this unscoped behavior.

## M3.2a task-aware Browser operations

[ADR-013](adr/ADR-013-task-conversation-binding.md) freezes one durable task ↔ one ChatGPT conversation. Public `send --task` and `wait --task` targeting is backed by `.chatbridge/runs/<taskId>/browser.json`. Task-aware operations read the binding before browser connection and use the exact conversation URL plus task-scoped outgoing message ID. Multiple unrelated ChatGPT tabs do not affect a bound task.

The first task-aware send remains fail-closed: without an existing binding or explicit validated `--conversation-url`, multiple eligible ChatGPT tabs still return `CHATGPT_TAB_AMBIGUOUS`. A missing bound tab is reopened only at the exact allowlisted URL; failure returns `CHATGPT_CONVERSATION_UNAVAILABLE`, never an automatic rebind. Unscoped `send` and `wait` retain Frozen M1 behavior and `.chatbridge/session.json` compatibility.

Planner and Reviewer traffic in the repository Skill uses `send --task <taskId>` and `wait --task <taskId> --parse`. A confirmed send plus wait timeout permits only another task-aware wait; it never permits replay. Real Desktop multiple-tab acceptance passed with explicit C1 bootstrap while unrelated C2/C3 remained open, task-bound Planner wait, and exact C1 reopen for both review send and Reviewer wait after manual tab closure. The binding and original `boundAt` stayed stable, task-scoped pending send was replaced only after confirmed send, and the legacy global SessionStore remained isolated. Private conversation and message identifiers remain only in local gitignored evidence. `EXECUTING` crash reconciliation is next in M3.2b, and explicit rebind/cleanup/recovery UX remains deferred to M3.2c.

## M3.2b planned EXECUTING resume

[ADR-014](adr/ADR-014-executing-crash-reconciliation.md) freezes local deterministic reconciliation without adding a C2C state or another Executor. A future Skill resume at `EXECUTING` will invoke `duet reconcile-execution --task <taskId>` and follow its evidence-backed action: resume the same plan from a Git-clean baseline, preserve and continue an in-progress worktree, obtain honest exact-HEAD test evidence for committed work, proceed directly to prepare review when evidence is current, or use normal `EXECUTED` resume after conclusive Frozen M2 adoption.

Recovery is resume, never blind replay. The Skill must not reset, clean, stash, discard edits, recreate existing commits, infer PASS, repush already prepared M2 work, start another Codex, or claim exactly-once safety for arbitrary external commands. The planned `duet record-tests --task <taskId> --status PASS|FAIL|NOT_RUN` binds durable test evidence to the current clean task-branch `HEAD`; a later commit makes it stale. These commands and behaviors are design-only until M3.2b implementation lands.
