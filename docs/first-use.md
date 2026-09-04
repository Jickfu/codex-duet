# First-use checks / 首次使用检查

After installation, run from your target project's Git root:

```text
node .agents/skills/codex-duet/scripts/chatbridge.mjs onboard --mode github
```

For LOCAL use `--mode local`. The mode is required; the command never guesses or changes it. This is a read-only local check. It does not fetch, authenticate, open a browser, approve OAuth, create tasks, copy contracts or commit anything.

## Read the result

| Result                          | Meaning / 含义                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| `FAIL`                          | A local prerequisite is missing; follow the check's `next` guidance / 先处理本地缺失项    |
| `REQUIRED`                      | An external prerequisite needs separate verification / 还需验证权限、登录或连接           |
| `localPrerequisitesReady: true` | Local checks passed; this is not task readiness / 仅表示本地检查通过                      |
| `taskReady: false`              | Always explicit: this command cannot prove live task readiness / 本命令不验证真实任务就绪 |

Exit code 1 means local prerequisites are missing; 0 means only local prerequisites passed. Errors are summarized without printing raw Git diagnostics, filenames from dirty status, or remote credentials.

## Resolve local prerequisites

1. If installation fails, run `doctor` and resolve the reported tool/package issue.
2. Use the target Git worktree root with an existing HEAD. Never initialize or replace a user's repository just to turn a check green.
3. GITHUB requires the intended GitHub `origin` and a clean worktree. Installed skill files may be untracked; review how to version them with the user. Do not auto-stash, reset or commit unrelated changes. LOCAL permits dirty work and does not require a remote.
4. Planner/Reviewer contracts must be nonempty blobs in HEAD under `docs/contracts/`. LOCAL uses `local-planner-v1.md` and `local-reviewer-v1.md`; GITHUB uses `planner-v1.md` and `reviewer-v1.md`. A file that exists only in the worktree is insufficient. Presence does not prove semantic correctness. Inspect existing contracts; if absent, propose the bundled contract as a separate setup change before task initialization.

## Verify external prerequisites

For GITHUB, verify that the intended account can access the target repository and ChatGPT can read the formal review refs. Local `origin` validation does not test credentials or remote existence.

Choose one Browser provider before task setup. For `CODEX_BROWSER`, use the host's supported browser tools and the user's intended ChatGPT session. For `PLAYWRIGHT_CLI`, follow [the Browser guide](browser-bridge.md); browser doctor/attach may launch a browser, unlike onboarding. Do not silently switch providers or send a probe message. Authentication remains user-controlled.

For LOCAL, follow [LOCAL setup](local-mode.md) and [remote development setup](remote-local-mode.md). Temporary remote access and each OAuth approval remain explicit. No tunnel is started by onboarding.

Once the prerequisites are genuinely verified, follow the [GITHUB skill workflow](../.agents/skills/codex-duet/references/workflow.md) in a source checkout, or the installed skill's `references/workflow.md`. Use the separate LOCAL lifecycle for LOCAL. For an existing task, inspect its durable status instead of creating it again. A first real Planner-to-Reviewer acceptance requires the actual user account, browser and target; passing these local checks cannot substitute for that acceptance.
