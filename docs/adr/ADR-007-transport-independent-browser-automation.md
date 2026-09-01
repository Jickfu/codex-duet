# ADR-007: Browser automation boundary is transport-independent

Status: Accepted

## Decision

`BrowserContext` is an implementation detail, not the Browser Bridge public boundary. Business commands depend on `BrowserAutomationSession`. Playwright Library and official Agent CLI transports implement it while shared ChatGPT page rules remain a single source of truth.

## Consequences

Extension and channel-CDP reuse native sessions without exposing CLI details to Codex. CLI stdout, snapshots, and chat history are captured and discarded inside the runner. A pinned `@playwright/cli` replaces runtime `npx`; browser installation stays explicit. All transports preserve origin guards and final-payload-only output.

`@playwright/cli` is exact-pinned and retains its own dependency graph. The direct Playwright Library version is independently upgradeable; no package override forces the two transports onto one Playwright version. CLI executable discovery follows the package's public `bin` metadata, validates containment within the package root, and never invokes a shell or runtime package downloader.
