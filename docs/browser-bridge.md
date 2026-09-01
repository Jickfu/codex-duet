# Browser Bridge

`BrowserConnection` owns transport setup; `ChatGPTWebAdapter` owns every ChatGPT-specific DOM detail. Business and protocol modules contain no selectors. M1 launches Playwright Chromium with a project-local persistent profile and a loopback-only CDP endpoint, then commands connect to that managed process.

Locator priority is stable IDs/data attributes, semantic roles/ARIA, then structural fallback. Sending records the existing assistant-message count. Waiting targets the next message, observes streaming markers and stop controls, and returns only non-empty final text. An ambiguous or unfinished response times out explicitly.

Screenshots are not normal transport. Real-site tests are manual and optional. Offline fixture tests model sending, delayed response creation, streaming completion, multiple messages, malformed protocol, and timeout.

M1 limitations: one profile, one ChatGPT tab selected, one outstanding checkpoint, and UI heuristics that may need adapter-only updates after a site redesign. Existing-Chrome attachment is a future `BrowserConnection`, not adapter behavior.
