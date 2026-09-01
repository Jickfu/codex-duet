# ADR-006: Prefer existing browser attachment over bundled browser runtime

Status: Accepted

## Context

Requiring every user to download Playwright Chromium and log in again creates avoidable setup cost. Existing Chrome/Edge sessions may already contain a valid ChatGPT login. Playwright publicly supports Chromium attachment over CDP and offers extension attachment through its Agent CLI, but does not currently expose that extension transport as a BrowserContext Library API.

## Decision

Runtime priority is attachable existing Chrome/Edge, installed Chrome/Edge with a codex-duet dedicated profile, then already-installed bundled Chromium. Browser downloads are never silent. Existing attachment uses Playwright's public `connectOverCDP`; private extension protocols and CLI-state parsing are prohibited. Extension transport will be added when a stable public interface can preserve the typed BrowserConnection/ChatGPTWebAdapter boundary.

## Security consequences

Existing browsers increase the trust surface because unrelated tabs share a context. A mandatory origin policy compensates: discovery observes URLs only, every adapter operation revalidates the configured ChatGPT origin, and unrelated pages and browser storage are never read or operated. Detach must not exit the user's browser.

## Why bundled Chromium remains

Bundled Chromium provides reproducible offline fixture tests, CI execution, and an explicit fallback when no supported installed browser exists.
