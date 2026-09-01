---
name: codex-duet
description: Orchestrate a GitHub-mode task through ChatGPT Web planning and review when the user explicitly says "use codex-duet", "使用 codex-duet", "用 codex-duet", or "Ask ChatGPT to plan and review". Do not invoke for ordinary coding requests because this workflow creates a task branch, commits, and a verified push.
---

# Codex Duet

Act as the outer orchestrator and sole Executor. ChatGPT Web is only the Planner, Architect, and Reviewer. Follow [the deterministic multi-round workflow](references/workflow.md) and the repository's authoritative architecture documents, especially `docs/architecture.md`, ADR-010, ADR-012, and ADR-013.

Normalize the user's request without changing it, expanding scope, or deciding major product choices. Unless the user explicitly asks to skip planning, obtain a ChatGPT PLAN before editing.

Use only the public Browser Bridge commands `send`, `wait`, `browser attach`, `browser detach`, and `browser doctor`. Use `chatbridge duet` for lifecycle guards. Never inspect ChatGPT DOM/selectors, invoke Playwright internals, operate Codex Desktop UI, start another Codex agent, or require Codex CLI or a Codex SDK.

Every Planner and Reviewer Browser operation is task-aware: use `chatbridge send --task <taskId>` and `chatbridge wait --task <taskId>`. The first send normally omits `--conversation-url`; if bootstrap is ambiguous, fail closed and ask the user for an explicit target rather than guessing. Once bound, always reuse the durable task conversation.

Stop on every deterministic rejection or ambiguous send outcome. Do not push directly; M2 `GitHubCodeProvider` owns safe push and immutable review identity.

After editing, commit the candidate, run appropriate tests on that exact commit, and persist the honest result with `chatbridge duet record-tests --task <taskId> --status <status>` before `prepare-review`. A later commit makes prior test evidence stale.

For durable `EXECUTING`, run `chatbridge duet reconcile-execution --task <taskId>` and follow its structured action. Resume from observable state: preserve dirty work, adopt existing commits, never infer PASS, and never blindly replay the PLAN. Conclusive Frozen M2 adoption resumes the normal `EXECUTED` flow without repush. Arbitrary external side effects remain unverified; stop rather than replaying a non-idempotent operation that Git evidence cannot prove safe.

When a Reviewer returns a valid next-iteration `PLAN`, continue the review-directed correction loop yourself without asking the user to say "continue". Never start another Codex agent, CLI, SDK, daemon, or Node-based Executor loop.
