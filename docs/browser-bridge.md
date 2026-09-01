# Browser Bridge

`BrowserConnection` owns transport setup; `ChatGPTWebAdapter` owns every ChatGPT-specific DOM detail. Business and protocol modules contain no selectors. M1.1 supports existing-browser CDP attachment, installed Chrome/Edge with dedicated persistent profiles, and bundled Chromium fallback. Managed processes expose a loopback-only CDP endpoint.

Locator priority is stable IDs/data attributes, semantic roles/ARIA, then structural fallback. Sending records the existing assistant-message count. Waiting targets the next message, observes streaming markers and stop controls, and returns only non-empty final text. An ambiguous or unfinished response times out explicitly.

The adapter receives an origin allowlist and validates its selected page before every DOM operation. Discovery examines URL strings only. It reuses an allowlisted ChatGPT page or creates a new tab; it never repurposes, reads, clicks, or evaluates a non-ChatGPT tab.

Screenshots are not normal transport. Real-site tests are manual and optional. Offline fixture tests model sending, delayed response creation, streaming completion, multiple messages, malformed protocol, and timeout.

M1.1 limitations: extension attachment cannot be integrated without a public Playwright Library transport, CDP requires a browser started with remote debugging, and UI heuristics may need adapter-only updates after a site redesign.
