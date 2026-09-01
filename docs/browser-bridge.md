# Browser Bridge

`BrowserAutomationSession` owns high-level deterministic operations. Library/CDP and official Agent CLI Extension/channel-CDP transports implement it without exposing `BrowserContext`, snapshots, or DOM output to callers. ChatGPT-specific rules have one shared source.

Locator priority is stable IDs/data attributes, semantic roles/ARIA, then structural fallback. Sending records the existing assistant-message count. Waiting targets the next message, observes streaming markers and stop controls, and returns only non-empty final text. An ambiguous or unfinished response times out explicitly.

The adapter receives an origin allowlist and validates its selected page before every DOM operation. Discovery examines URL strings only. It reuses an allowlisted ChatGPT page or creates a new tab; it never repurposes, reads, clicks, or evaluates a non-ChatGPT tab.

Screenshots are not normal transport. Real-site tests are manual and optional. Offline fixture tests model sending, delayed response creation, streaming completion, multiple messages, malformed protocol, and timeout.

M1.2 pins the official `@playwright/cli` package. CLI stdout and snapshot descriptions are captured internally; only structured bridge results escape. Official `detach` leaves external browsers and tabs running.

Generated CLI operations run in a restricted sandbox and do not assume `URL`, Node globals, or complete browser globals. Allowed origins are canonicalized in Node, then matched in the sandbox using exact origin boundaries. Results and allowlisted bridge errors use a per-operation random nonce; echoed source text cannot impersonate an error signal.

## Dependency compatibility

The Library transport and CLI transport are separate implementations of `BrowserAutomationSession`. The direct `playwright` dependency may be upgraded through the normal dependency-update workflow and must pass the offline Library transport suite. `@playwright/cli` is exact-pinned and uses its own declared Playwright dependency; codex-duet does not override or deduplicate it. CLI upgrades require the CLI taxonomy, attach/fallback, generated run-code, and manual existing-browser regression checks. The executable is resolved from the package's public `bin` metadata and validated to remain inside that package, rather than depending on an internal filename or runtime `npx`.
