# Browser Bridge

`BrowserAutomationSession` owns high-level deterministic operations. Library/CDP and official Agent CLI Extension/channel-CDP transports implement it without exposing `BrowserContext`, snapshots, or DOM output to callers. ChatGPT-specific rules have one shared source.

Locator priority is stable IDs/data attributes, semantic roles/ARIA, then structural fallback. Sending records the existing assistant-message count. Waiting targets the next message, observes streaming markers and stop controls, and returns only non-empty final text. An ambiguous or unfinished response times out explicitly.

The adapter receives an origin allowlist and validates its selected page before every DOM operation. Discovery examines URL strings only. It reuses an allowlisted ChatGPT page or creates a new tab; it never repurposes, reads, clicks, or evaluates a non-ChatGPT tab.

Screenshots are not normal transport. Real-site tests are manual and optional. Offline fixture tests model sending, delayed response creation, streaming completion, multiple messages, malformed protocol, and timeout.

M1.2 pins the official `@playwright/cli` package. CLI stdout and snapshot descriptions are captured internally; only structured bridge results escape. Official `detach` leaves external browsers and tabs running.
