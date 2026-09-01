# ADR-010: Dual-mode Data Plane Architecture

## Status

Accepted as the architecture design freeze before M3.

## Context

Codex Desktop must remain the outer orchestrator and sole workspace Executor while ChatGPT Web plans, architects, and reviews. Control messages are small, but code review requires a mode-appropriate source of repository context.

## Decision

The Browser Bridge is the shared Control Plane for compact C2C messages.

- GITHUB mode uses GitHub as its code Data Plane.
- LOCAL mode uses a read-only MCP bridge, exposed through cloudflared, as its planned code Data Plane.
- Both modes share one protocol, state machine, orchestration core, and Browser Control Plane.
- Each mode supplies its Data Plane through the shared `CodeProvider` boundary.

GITHUB formal review is the immutable full-SHA range `BASE_REF..REVIEW_REF`. LOCAL review may inspect uncommitted state and does not require commit, push, or a fabricated Git SHA; its snapshot/fingerprint contract is deferred to M4.

cloudflared is only LOCAL Data Plane transport from remote HTTPS to the localhost MCP service. It is not a browser-control channel, Codex message channel, or Git transport.

The Local MCP workspace surface is permanently read-only. `submit_response` may update only internal `.chatbridge` task/run state and cannot mutate workspace content.

## Consequences

- Browser Bridge never transports repositories, source archives, or large diffs.
- GITHUB mode can review only committed and pushed code available through GitHub.
- LOCAL mode can eventually review private, unpushed, and uncommitted workspaces.
- LOCAL mode depends on M4 for the read-only MCP provider and review identity, and M5 for controlled remote exposure.
- The project must not duplicate orchestration logic between modes.
- Codex remains the sole Executor in every mode.
