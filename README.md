# codex-duet

`codex-duet` is a responsibility-separated software-development loop:

> ChatGPT thinks and reviews. Codex acts.

ChatGPT Web is the planner, architect, and reviewer. Codex Desktop is the outer orchestrator, and Codex is the only executor allowed to edit the workspace, run commands, or operate Git. A deterministic Playwright bridge carries compact control messages without feeding screenshots, DOM snapshots, chat history, repositories, or large diffs into the model context.

This release includes the **Frozen M2 GitHub Mode MVP** and frozen M3 Durable Desktop Orchestration with real Desktop acceptance. M4 implements the LOCAL immutable snapshot/read-only MCP data plane, guarded lifecycle, both selected Browser providers and optional Discussion; its acceptance scope is local/fixture-based. M5 adds a [remote development service](docs/remote-local-mode.md) with temporary HTTPS, local OAuth approval and read-only task grants; a [generated-task live acceptance](docs/milestones/M5-live-acceptance-2026-09-04.md) passed with bounded format repair and an authorized conversation handoff. M5 remains development, not frozen or integrated. PR automation is not implemented.

**M4's locally testable scope is frozen.** See the [exact implementation ref, verification and limits](docs/milestones/M4-local-readonly-mcp.md).

## Architecture summary

```text
Codex          = Execute
ChatGPT Web    = Plan + Architect + Review
Browser Bridge = Shared Control Plane

GITHUB mode → GitHub Data Plane
LOCAL mode  → Read-only MCP Data Plane (frozen local M4; remote M5 development)
```

GITHUB mode is implemented and frozen at M2. M3.0 through M3.3 are frozen with real Desktop E2E acceptance. M3.3 adds an immutable per-task Browser provider choice and optional bounded Discussion. M4 adds separate LOCAL snapshot/review authority without requiring a commit, push or remote; its disabled-by-default `submit_response` needs an exact control-scoped capability. Recovery does not claim exactly-once arbitrary external effects. Both modes share C2C, state transitions and response ingress. See [architecture](docs/architecture.md), [Control Plane and Data Planes](docs/data-plane.md), [GITHUB mode](docs/github-mode.md), [the M3 milestone](docs/milestones/M3-durable-orchestrator.md), and [LOCAL mode](docs/local-mode.md).

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
- LOCAL supports Git worktrees with an existing HEAD, immutable bounded snapshots and a loopback server library. The separate [M5 remote development service](docs/remote-local-mode.md) adds authenticated temporary exposure; a generated-task live ChatGPT LOCAL loop reached DONE; M5 remains development. See [LOCAL setup and limits](docs/local-mode.md).

See [protocol](docs/protocol.md), [security](docs/security.md), and the [Browser Bridge](docs/browser-bridge.md).
