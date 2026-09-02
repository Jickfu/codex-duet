# codex-duet

`codex-duet` is a responsibility-separated software-development loop:

> ChatGPT thinks and reviews. Codex acts.

ChatGPT Web is the planner, architect, and reviewer. Codex Desktop is the outer orchestrator, and Codex is the only executor allowed to edit the workspace, run commands, or operate Git. A deterministic Playwright bridge carries compact control messages without feeding screenshots, DOM snapshots, chat history, repositories, or large diffs into the model context.

This release includes the **Frozen M2 GitHub Mode MVP** data plane and the frozen M3.0, M3.1, and M3.2a Desktop contracts. M3.2b deterministic `EXECUTING` crash reconciliation is implemented, with real Desktop crash E2E still required. Local MCP, cloudflared, and PR automation are not implemented.

## Architecture summary

```text
Codex          = Execute
ChatGPT Web    = Plan + Architect + Review
Browser Bridge = Shared Control Plane

GITHUB mode → GitHub Data Plane
LOCAL mode  → Read-only MCP Data Plane (planned M4/M5)
```

GITHUB mode is implemented and frozen at M2. M3.0 single-round orchestration, M3.1 automatic Review/Fix, and M3.2a task-scoped conversation binding are frozen with real Desktop E2E acceptance. M3 overall remains in progress: M3.2b crash reconciliation is **IMPLEMENTATION COMPLETE / REAL DESKTOP CRASH E2E REQUIRED**, and M3.2c resume/Browser UX hardening is planned. M3.2b reconciles Git/worktree and explicit execution evidence without claiming exactly-once recovery for arbitrary external side effects. LOCAL MCP and `submit_response` are planned for M4; cloudflared lifecycle is planned for M5. Both modes share one C2C/state-machine/orchestration core. See [architecture](docs/architecture.md), [Control Plane and Data Planes](docs/data-plane.md), [GITHUB mode](docs/github-mode.md), [the M3 milestone](docs/milestones/M3-durable-orchestrator.md), and [LOCAL mode](docs/local-mode.md).

## Install

Requirements: Node.js 20 or newer and pnpm.

```text
pnpm install
pnpm build
pnpm link --global
```

## Recommended: Extension Existing Session

Install and enable the official Playwright Extension in everyday Chrome or Edge, keep the existing ChatGPT tab logged in, then run `chatbridge browser doctor` and `chatbridge browser attach`. This reuses tabs, cookies, SSO/2FA, and login state without creating a second profile or downloading Chromium. The official Agent CLI is pinned as a dependency; codex-duet never uses runtime `npx` downloads.

## Alternative: Channel CDP Existing Session

In normal Chrome or Edge, open `chrome://inspect/#remote-debugging`, enable “Allow remote debugging for this browser instance”, then use `chatbridge browser attach --transport cdp --browser chrome` or `--browser msedge`. Advanced raw endpoints remain available through `--endpoint`.

```text
chatbridge browser doctor
chatbridge browser attach
chatbridge browser attach --browser chrome --transport cdp
chatbridge browser attach --browser msedge --transport cdp --endpoint http://127.0.0.1:9224
```

If no attachable browser is found, `attach` starts installed Chrome and then Edge through Playwright's official browser channels, using `.chatbridge/profile`. Log in manually the first time. The bridge never reads, exports, or logs passwords, cookies, tokens, or browser storage.

If native attachment is unavailable, auto mode starts installed Chrome then Edge with a dedicated `.chatbridge/profile`; it never automates the daily browser's default profile.

## Bundled browser fallback and development

Bundled Chromium remains the fixture/CI browser and an explicit fallback. It is never installed silently:

```text
pnpm exec playwright install chromium
chatbridge browser attach --browser bundled
```

`chatbridge browser detach` releases an existing session without closing the user's browser or tabs.

## Send and wait

Write an `INIT` or `EXECUTED` C2C/1 message to a file, then:

```text
chatbridge send --message-file ./message.txt
chatbridge wait
chatbridge wait --parse
chatbridge status
```

`wait` performs deterministic DOM waiting internally and prints only the final assistant message. `--parse` rejects malformed C2C/1 and emits validated JSON. It times out rather than returning an incomplete streaming response.

## GitHub Mode

GitHub Mode creates one safe `agent/task-<taskId>` branch per task and produces an immutable full-SHA review range after a verified push:

```text
chatbridge github doctor
chatbridge github init-task --task demo
# edit, test, and commit
chatbridge github prepare-review --task demo --tests PASS
chatbridge github status --task demo
```

The worktree must be clean at initialization and review preparation. The tool never stashes, resets, cleans, force-pushes, or modifies the default branch. See [M2 GitHub Mode](docs/milestones/M2-github-mode.md).

## Security and limitations

- Browser automation uses the public ChatGPT UI and official Playwright APIs, never private or reverse-engineered APIs.
- Existing-browser automation has a mandatory origin allowlist; non-ChatGPT tabs are not inspected or operated.
- Login is manual. The isolated profile is local and must remain uncommitted.
- M1.2 supports one selected runtime and one outstanding send checkpoint per project.
- ChatGPT UI changes can require updates to the centralized adapter selectors.
- Real ChatGPT E2E is manual; CI fixtures are local and require no account.
- LOCAL read-only MCP remains architecture-only until a later milestone.

See [protocol](docs/protocol.md), [security](docs/security.md), and the [Browser Bridge](docs/browser-bridge.md).
