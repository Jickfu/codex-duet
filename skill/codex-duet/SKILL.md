---
name: codex-duet
description: Orchestrate a GitHub-mode task through ChatGPT Web planning and review when the user explicitly says "use codex-duet", "使用 codex-duet", "用 codex-duet", or "Ask ChatGPT to plan and review". Do not invoke for ordinary coding requests because this workflow creates a task branch, commits, and a verified push.
---

# Codex Duet

## Runtime and workspace

For the downloadable skill bundle, first follow [installation](INSTALL.md): `npm run setup` inside the skill directory verifies and installs the bundled runtime. Run `node "<absolute-skill-directory>/scripts/chatbridge.mjs" doctor`. In every command below and in the workflow reference, replace `chatbridge` with that absolute Node launcher. Keep the working directory at the user's target project; never run task initialization in the skill installation directory. The launcher preserves the working directory and uses only its adjacent installed runtime. In a source checkout without the bundled launcher, use the built CLI or an explicitly selected installed `chatbridge`.

Runtime documentation is available under the bundle's `node_modules/codex-duet/docs/` after setup. GITHUB mode requires its Planner/Reviewer contracts at `docs/contracts/planner-v1.md` and `docs/contracts/reviewer-v1.md` in the target repository's immutable baseline. Inspect existing contracts; if missing, propose copying the bundled contracts as a separate project setup change before starting the task. Never overwrite existing contracts or silently commit/push setup. Installation alone does not initialize tasks or authorize Browser sends. This skill's orchestration recipe covers GITHUB mode; for an explicit LOCAL request consult the installed `docs/local-mode.md` and `docs/remote-local-mode.md` instead of using `duet` as a LOCAL lifecycle.

Act as the outer orchestrator and sole Executor. ChatGPT Web is only the Planner, Architect, and Reviewer. Follow [the deterministic multi-round workflow](references/workflow.md) and the repository's authoritative architecture documents, especially `docs/architecture.md`, ADR-010, ADR-012, ADR-013, and ADR-015.

Normalize the user's request into a strict TaskSpecV1 without changing it, expanding scope, dropping exact literals, or deciding major product choices. Preserve the raw request separately. Codex owns normalization; chatbridge only validates and persists the candidate. For new tasks always pass `--task-spec-file` to `duet init`, which emits the compact Planner projection. Unless the user explicitly asks to skip planning, obtain a ChatGPT PLAN before editing.

The local gitignored TaskSpec is semantic authority; the bound ChatGPT conversation is only a semantic cache. The immutable Compact task marker pins TaskSpec and first Planner-control fingerprints. Missing or divergent marked evidence is corruption and must never fall back to legacy review. Stable Planner and Reviewer policy comes from the repository contracts at immutable `BASE_REF`, not repeated Browser boilerplate. Never send the complete raw request by default. Stop on `C2C_PAYLOAD_TOO_LARGE`; do not truncate, split, drop constraints, or attempt an attachment fallback. If the minimum sufficient projection cannot fit, report that a task context channel is required. Conversation unavailability remains fail closed with no automatic rebind.

Before any browser side effect for a new task, persist an immutable TaskInteractionPolicyV1 with `chatbridge duet interaction-init`. Select exactly one `browserControlProvider`: `CODEX_BROWSER` or `PLAYWRIGHT_CLI`; never silently fall back or switch providers. Historical tasks without this sidecar retain the frozen Playwright behavior.

For `PLAYWRIGHT_CLI`, use only the public Browser Bridge commands `send`, `wait`, `browser attach`, `browser detach`, and `browser doctor`. For `CODEX_BROWSER`, use Codex Desktop's browser capability plus `codex-browser-prepare`, `codex-browser-mark-attempted`, `codex-browser-complete`, and `codex-browser-receive`. Persist `ATTEMPTED` immediately before the Send gesture; unresolved `ATTEMPTED` and `OUTCOME_UNKNOWN` both forbid automatic replay. Use `chatbridge duet` for lifecycle guards. Never inspect ChatGPT DOM/selectors, invoke Playwright internals, start another Codex agent, or require Codex CLI or a Codex SDK.

Every Planner, Reviewer, and optional Discussion Browser operation is task-aware. `PLAYWRIGHT_CLI` uses `chatbridge send --task <taskId>` and `chatbridge wait --task <taskId>`. `CODEX_BROWSER` must use its checkpoint commands and exact durable conversation URL. If bootstrap is ambiguous, fail closed and ask the user for an explicit target rather than guessing. Once bound, always reuse the durable task conversation.

If `discussion.enabled` is true, run at most three `discussion-prepare` / `discussion-ingest` rounds while the run remains `PLANNING`. DiscussionResponseV1 is a separate strict protocol and must never be passed to normal C2C ingest. Only `CONVERGED` unlocks the final Planner envelope; `USER_DECISION_REQUIRED`, `FAILED`, malformed identity, or the round limit stops the workflow.

Stop on every deterministic rejection or ambiguous send outcome. Do not push directly; M2 `GitHubCodeProvider` owns safe push and immutable review identity.

After editing, commit the candidate, run appropriate tests on that exact commit, and persist the honest result with `chatbridge duet record-tests --task <taskId> --status <status>` before `prepare-review`. A later commit makes prior test evidence stale.

For durable `EXECUTING`, run `chatbridge duet reconcile-execution --task <taskId>` and follow its structured action. Resume from observable state: preserve dirty work, adopt existing commits, never infer PASS, and never blindly replay the PLAN. Conclusive Frozen M2 adoption resumes the normal `EXECUTED` flow without repush. Arbitrary external side effects remain unverified; stop rather than replaying a non-idempotent operation that Git evidence cannot prove safe.

When a Reviewer returns a valid next-iteration `PLAN`, continue the review-directed correction loop yourself without asking the user to say "continue". Never start another Codex agent, CLI, SDK, daemon, or Node-based Executor loop.
