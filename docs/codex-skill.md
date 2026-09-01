# Codex Desktop Skill

Status: **M3.0 implementation complete**

Desktop E2E: **MANUAL REQUIRED**

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

The Skill asks ChatGPT Web for a PLAN through the Frozen Browser Bridge before code changes. The current Codex Desktop agent performs the implementation as the only Executor. `chatbridge duet prepare-review` composes the Frozen GitHub provider to produce and push an immutable `BASE_REF..REVIEW_REF`; ChatGPT then reviews that exact range.

No Codex CLI, Codex SDK, secondary Codex agent, daemon, or automated Codex Desktop UI control is required.

## Windows Desktop manual acceptance

1. Start from a clean repository with a supported GitHub `origin` and an authenticated existing browser/session.
2. Open the repository in Codex Desktop and issue the harmless docs-only example above.
3. Confirm the visible lifecycle is `PLANNING → PLAN → EXECUTING → EXECUTED → REVIEWING → DONE`.
4. Confirm Codex did not push directly, the remote task-branch SHA equals `REVIEW_REF`, and review used the immutable range.
5. Confirm `.chatbridge/runs/<taskId>.json` supports a restart at each documented safe state.

Do not report Desktop Skill E2E as passed until a real user completes this procedure.

## Troubleshooting

- Run `chatbridge browser doctor` when browser prerequisites fail.
- Prefer an existing authenticated browser/session. If Chrome asks for remote-debugging authorization, approve it explicitly and retry; this is not a task failure.
- An ambiguous `send` result, invalid C2C response, dirty worktree, unexpected branch, or M2 safety rejection is a stop condition.
- `EXECUTION_RECOVERY_REQUIRED` means M3.0 cannot safely infer which plan steps already ran. Inspect and reconcile manually rather than replaying the plan.
- At `EXECUTED`, resend the durable review envelope path returned by `chatbridge duet status`, then mark reviewing only after send succeeds.
