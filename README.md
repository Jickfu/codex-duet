# codex-duet

`codex-duet` is a responsibility-separated software-development loop:

> ChatGPT thinks and reviews. Codex acts.

ChatGPT Web is the planner, architect, and reviewer. Codex is the only executor allowed to edit the workspace, run commands, or operate Git. A deterministic Playwright bridge carries control messages without feeding screenshots, DOM snapshots, chat history, or polling loops into the model context.

This release implements **M0 (architecture/protocol)** and **M1 (Browser Bridge MVP)** only. GitHub automation, Local MCP, cloudflared, and the durable orchestrator are deliberately not implemented.

## Install

Requirements: Node.js 20 or newer and pnpm.

```text
pnpm install
pnpm exec playwright install chromium
pnpm build
pnpm link --global
```

## First start and manual login

```text
chatbridge browser doctor
chatbridge browser open
```

The bridge opens a managed Chromium profile in `.chatbridge/profile`. Log in to ChatGPT yourself the first time. The bridge never asks for, reads, exports, or logs passwords, cookies, tokens, or browser storage. The profile is ignored by Git.

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

- Browser automation uses only the public ChatGPT website UI, never private or reverse-engineered APIs.
- Login is manual. The isolated profile is local and must remain uncommitted.
- M1 supports one managed Chromium profile and one outstanding send checkpoint per project.
- ChatGPT UI changes can require updates to the centralized adapter selectors.
- Real ChatGPT E2E is manual; CI fixtures are local and require no account.
- LOCAL read-only MCP and GITHUB data-plane workflows are architecture-only until later milestones.

See [architecture](docs/architecture.md), [protocol](docs/protocol.md), [security](docs/security.md), and the [Browser Bridge](docs/browser-bridge.md).
