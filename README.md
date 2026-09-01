# codex-duet

`codex-duet` is a responsibility-separated software-development loop:

> ChatGPT thinks and reviews. Codex acts.

ChatGPT Web is the planner, architect, and reviewer. Codex is the only executor allowed to edit the workspace, run commands, or operate Git. A deterministic Playwright bridge carries control messages without feeding screenshots, DOM snapshots, chat history, or polling loops into the model context.

This release implements **M0**, **M1**, and **M1.1 Existing Browser Support** only. GitHub automation, Local MCP, cloudflared, and the durable orchestrator are deliberately not implemented.

## Install

Requirements: Node.js 20 or newer and pnpm.

```text
pnpm install
pnpm build
pnpm link --global
```

## Recommended browser setup

The bridge first looks for an already-running Chrome or Edge exposed through an official CDP endpoint, then uses installed Chrome or Edge with a dedicated codex-duet profile. A second Chromium download is not required for normal use.

For existing-browser CDP attachment, start Chrome or Edge yourself with remote debugging on a loopback port and keep ChatGPT logged in. Modern Chrome requires a non-default user-data directory for remote debugging; codex-duet never restarts or automates your normal default profile.

```text
chatbridge browser doctor
chatbridge browser attach
chatbridge browser attach --browser chrome --transport cdp
chatbridge browser attach --browser msedge --transport cdp --endpoint http://127.0.0.1:9224
```

If no attachable browser is found, `attach` starts installed Chrome and then Edge through Playwright's official browser channels, using `.chatbridge/profile`. Log in manually the first time. The bridge never reads, exports, or logs passwords, cookies, tokens, or browser storage.

Playwright extension attachment is currently exposed through its Agent CLI, not a public `BrowserContext` Library API. `--transport extension` gives a clear diagnostic rather than using a private protocol.

## Bundled browser fallback and development

Bundled Chromium remains the fixture/CI browser and an explicit fallback. It is never installed silently:

```text
pnpm exec playwright install chromium
chatbridge browser attach --browser bundled
```

## Send and wait

Write an `INIT` or `EXECUTED` C2C/1 message to a file, then:

```text
chatbridge send --message-file ./message.txt
chatbridge wait
chatbridge wait --parse
chatbridge status
```

`wait` performs deterministic DOM waiting internally and prints only the final assistant message. `--parse` rejects malformed C2C/1 and emits validated JSON. It times out rather than returning an incomplete streaming response.

## Security and limitations

- Browser automation uses the public ChatGPT UI and official Playwright APIs, never private or reverse-engineered APIs.
- Existing-browser automation has a mandatory origin allowlist; non-ChatGPT tabs are not inspected or operated.
- Login is manual. The isolated profile is local and must remain uncommitted.
- M1.1 supports one selected runtime and one outstanding send checkpoint per project.
- ChatGPT UI changes can require updates to the centralized adapter selectors.
- Real ChatGPT E2E is manual; CI fixtures are local and require no account.
- LOCAL read-only MCP and GITHUB data-plane workflows are architecture-only until later milestones.

See [architecture](docs/architecture.md), [protocol](docs/protocol.md), [security](docs/security.md), and the [Browser Bridge](docs/browser-bridge.md).
