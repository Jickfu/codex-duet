# M1 Browser Bridge

Status: implementation complete; native existing-session acceptance **MANUAL REQUIRED**. M1 is not frozen until either Extension or channel-CDP completes the real-user E2E checklist.

## Delivered increments

- M1 established the deterministic Playwright adapter, persistent managed profile, send/wait/status/doctor CLI, and offline fixture tests.
- M1.1 introduced existing-browser support and explicit browser lifecycle ownership.
- M1.2 introduced the transport-independent `BrowserAutomationSession`, official Playwright Extension/channel-CDP transports, raw CDP, and ordered fallback.
- M1.2.1 hardens navigation invalidation, CLI error taxonomy, attach-phase fallback semantics, executable discovery, diagnostics, and compatibility policy.
- M1.2.2 removes unsupported host-global assumptions from generated CLI sandbox code, adds canonical origin-boundary matching and nonce-bound structured bridge errors, and softens interactive CDP doctor diagnostics.

## Frozen contract candidate

The Codex-visible interface is `send`, `wait`, `attach`, `detach`, and `doctor`. Transport implementations are Extension, channel CDP, raw CDP, managed installed Chrome/Edge, and bundled Chromium. Browser internal state—including snapshots, DOM, accessibility trees, browser storage, and chat history—is never model context. Callers receive only final assistant text, structured status, or sanitized errors.

M2 and M3 must depend on `BrowserAutomationSession`; they must not call Playwright selectors or transport-specific CLI operations directly.

After native acceptance, Browser Bridge architecture is frozen except for security defects, ChatGPT UI compatibility, Playwright compatibility, or confirmed browser-lifecycle defects.

## Native acceptance gate

Run [the manual existing-browser E2E](../manual-existing-browser-e2e.md) in a normal signed-in Chrome or Edge session. At least one of Extension or channel CDP must demonstrate send/wait/detach without a new profile, browser download, login, snapshot leakage, or browser/tab closure. Record the environment and result here before changing the status to Frozen.

Baseline finding (2026-09-01): Channel CDP successfully attached to the normal Chrome profile and enumerated its existing tabs, but `run-code` exposed neither `URL` nor `globalThis.URL`. This caused the pre-M1.2.2 matcher to reject every page.

Post-fix native result (2026-09-01): attach returned `existing-channel-cdp` and login-state validation succeeded against the existing Chrome session, confirming the sandbox origin fix. The subsequent `send` returned `PLAYWRIGHT_CLI_TIMEOUT`, so no final `wait` payload could be accepted. Detach completed without requesting browser shutdown. The native gate remains MANUAL REQUIRED and M1 is not Frozen; the send timeout requires a separately scoped compatibility diagnosis rather than an unverified DOM-click workaround.
