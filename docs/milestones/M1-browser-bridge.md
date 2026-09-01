# M1 Browser Bridge

Status: implementation complete; native existing-session acceptance **MANUAL REQUIRED**. M1 is not frozen until either Extension or channel-CDP completes the real-user E2E checklist.

## Delivered increments

- M1 established the deterministic Playwright adapter, persistent managed profile, send/wait/status/doctor CLI, and offline fixture tests.
- M1.1 introduced existing-browser support and explicit browser lifecycle ownership.
- M1.2 introduced the transport-independent `BrowserAutomationSession`, official Playwright Extension/channel-CDP transports, raw CDP, and ordered fallback.
- M1.2.1 hardens navigation invalidation, CLI error taxonomy, attach-phase fallback semantics, executable discovery, diagnostics, and compatibility policy.
- M1.2.2 removes unsupported host-global assumptions from generated CLI sandbox code, adds canonical origin-boundary matching and nonce-bound structured bridge errors, and softens interactive CDP doctor diagnostics.
- M1.2.3 replaces assistant-count checkpoints with outgoing-user causal identity, exact conversation binding, per-poll message re-querying, and recoverable send-side-effect semantics.
- M1.2.3 final hardening applies the full origin guard to every recovery candidate and treats post-click identity observation failure as an ambiguous send outcome.
- M1.2.4 finalizes the verified Playwright CLI sandbox contract and replaces unavailable host timers with `page.waitForTimeout`.

## Frozen contract candidate

The Codex-visible interface is `send`, `wait`, `attach`, `detach`, and `doctor`. Transport implementations are Extension, channel CDP, raw CDP, managed installed Chrome/Edge, and bundled Chromium. Browser internal state—including snapshots, DOM, accessibility trees, browser storage, and chat history—is never model context. Callers receive only final assistant text, structured status, or sanitized errors.

M2 and M3 must depend on `BrowserAutomationSession`; they must not call Playwright selectors or transport-specific CLI operations directly.

After native acceptance, Browser Bridge architecture is frozen except for security defects, ChatGPT UI compatibility, Playwright compatibility, or confirmed browser-lifecycle defects.

## Native acceptance gate

Run [the manual existing-browser E2E](../manual-existing-browser-e2e.md) in a normal signed-in Chrome or Edge session. At least one of Extension or channel CDP must demonstrate send/wait/detach without a new profile, browser download, login, snapshot leakage, or browser/tab closure. Record the environment and result here before changing the status to Frozen.

Baseline finding (2026-09-01): Channel CDP successfully attached to the normal Chrome profile and enumerated its existing tabs, but `run-code` exposed neither `URL` nor `globalThis.URL`. This caused the pre-M1.2.2 matcher to reject every page.

Post-fix native result (2026-09-01): attach returned `existing-channel-cdp` and login-state validation succeeded against the existing Chrome session, confirming the sandbox origin fix. The subsequent `send` returned `PLAYWRIGHT_CLI_TIMEOUT`, so no final `wait` payload could be accepted. Detach completed without requesting browser shutdown. The native gate remains MANUAL REQUIRED and M1 is not Frozen; the send timeout requires a separately scoped compatibility diagnosis rather than an unverified DOM-click workaround.

M1.2.3 acceptance requires two consecutive real Channel CDP `send -> wait` rounds anchored by version-2 message IDs, followed by detach with the normal Chrome profile, tabs, and login state intact. Until that exact gate succeeds, status remains MANUAL REQUIRED.

Post-build M1.2.3 attempt (2026-09-01): Chrome no longer exposed an authorized Channel CDP connection, so attach stopped before any send. No two-round result is claimed. Re-enable remote debugging in the normal Chrome session and repeat the documented gate before changing status to Frozen.
