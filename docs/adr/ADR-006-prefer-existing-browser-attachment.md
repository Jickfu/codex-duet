# ADR-006: Prefer existing browser attachment over bundled browser runtime

Status: Accepted

## Context

Requiring every user to download Playwright Chromium and log in again creates avoidable setup cost. The official Playwright Agent CLI supports Extension and channel-CDP attachment to everyday Chrome/Edge sessions.

## Decision

Runtime priority is Extension Chrome/Edge, channel-CDP Chrome/Edge, explicit raw CDP, installed Chrome/Edge with a dedicated profile, then bundled Chromium. Existing attachment uses the pinned official Agent CLI. Private extension protocols and CLI session-file inspection are prohibited.

## Security consequences

Existing browsers increase the trust surface because unrelated tabs share a context. A mandatory origin policy compensates: discovery observes URLs only, every adapter operation revalidates the configured ChatGPT origin, and unrelated pages and browser storage are never read or operated. Detach must not exit the user's browser.

## Why bundled Chromium remains

Bundled Chromium provides reproducible offline fixture tests, CI execution, and an explicit fallback when no supported installed browser exists.
