# Codex Desktop Skill

Status: **M3.0 Single-Round Orchestration Frozen**

Desktop E2E: **PASS**

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

## Roadmap

- M3.0 Single-Round Orchestration: **Frozen**.
- M3 overall: **IN PROGRESS**.
- M3.1 Automatic Multi-Round Review/Fix Loop: **DESIGN FROZEN / IMPLEMENTATION NEXT**.
- M3.2 Recovery / Conversation Binding / UX Hardening: **PLANNED**.

M3.1 must build on the frozen single-round contract. Its frozen design keeps one task branch and one immutable task-level `BASE_REF`; every formal review is cumulative `BASE_REF..CURRENT_REVIEW_REF`, while `PREVIOUS_REVIEW_REF..CURRENT_REVIEW_REF` is only a delta focus. A valid Reviewer `PLAN` for iteration `N+1` will eventually continue automatically, subject to deterministic guards and a configurable iteration limit. This documentation freeze does not implement that loop or change M4/M5/M6 ownership. See [the M3 milestone](milestones/M3-durable-orchestrator.md) and [ADR-012](adr/ADR-012-multi-round-review-identity.md).

## Troubleshooting

- Run `chatbridge browser doctor` when browser prerequisites fail.
- Prefer an existing authenticated browser/session. If Chrome asks for remote-debugging authorization, approve it explicitly and retry; this is not a task failure.
- An ambiguous `send` result, invalid C2C response, dirty worktree, unexpected branch, or M2 safety rejection is a stop condition.
- `EXECUTION_RECOVERY_REQUIRED` means M3.0 cannot safely infer which plan steps already ran. Inspect and reconcile manually rather than replaying the plan.
- At `EXECUTED`, resend the durable review envelope path returned by `chatbridge duet status`, then mark reviewing only after send succeeds.
- At durable `REVIEWING`, a Browser wait timeout permits retrying `wait --parse` and ingest against the existing send checkpoint; it does not permit resending the review envelope or replaying Executor side effects.
- Multiple ChatGPT tabs without an explicit current target fail closed with `CHATGPT_TAB_AMBIGUOUS`; task/conversation binding is deferred to future hardening.
