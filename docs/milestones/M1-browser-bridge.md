# M1 Browser Bridge

Status: implementation complete; native existing-session acceptance **MANUAL REQUIRED**. M1 is not frozen until either Extension or channel-CDP completes the real-user E2E checklist.

## Delivered increments

- M1 established the deterministic Playwright adapter, persistent managed profile, send/wait/status/doctor CLI, and offline fixture tests.
- M1.1 introduced existing-browser support and explicit browser lifecycle ownership.
- M1.2 introduced the transport-independent `BrowserAutomationSession`, official Playwright Extension/channel-CDP transports, raw CDP, and ordered fallback.
- M1.2.1 hardens navigation invalidation, CLI error taxonomy, attach-phase fallback semantics, executable discovery, diagnostics, and compatibility policy.

## Frozen contract candidate

The Codex-visible interface is `send`, `wait`, `attach`, `detach`, and `doctor`. Transport implementations are Extension, channel CDP, raw CDP, managed installed Chrome/Edge, and bundled Chromium. Browser internal state—including snapshots, DOM, accessibility trees, browser storage, and chat history—is never model context. Callers receive only final assistant text, structured status, or sanitized errors.

M2 and M3 must depend on `BrowserAutomationSession`; they must not call Playwright selectors or transport-specific CLI operations directly.

After native acceptance, Browser Bridge architecture is frozen except for security defects, ChatGPT UI compatibility, Playwright compatibility, or confirmed browser-lifecycle defects.

## Native acceptance gate

Run [the manual existing-browser E2E](../manual-existing-browser-e2e.md) in a normal signed-in Chrome or Edge session. At least one of Extension or channel CDP must demonstrate send/wait/detach without a new profile, browser download, login, snapshot leakage, or browser/tab closure. Record the environment and result here before changing the status to Frozen.

Current result (2026-09-01): MANUAL REQUIRED. This execution environment reported Extension unavailable and channel CDP not authorized; no native-session result is claimed.
