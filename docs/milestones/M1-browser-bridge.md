# M1 Browser Bridge

Status: **Frozen**

Frozen implementation baseline: `58ce189f66d1850be2fd7a47596796b8803eff83`

## Delivered increments

- M1 established the deterministic Playwright adapter, persistent managed profile, send/wait/status/doctor CLI, and offline fixture tests.
- M1.1 introduced existing-browser support and explicit browser lifecycle ownership.
- M1.2 introduced the transport-independent `BrowserAutomationSession`, official Playwright Extension/channel-CDP transports, raw CDP, and ordered fallback.
- M1.2.1 hardens navigation invalidation, CLI error taxonomy, attach-phase fallback semantics, executable discovery, diagnostics, and compatibility policy.
- M1.2.2 removes unsupported host-global assumptions from generated CLI sandbox code, adds canonical origin-boundary matching and nonce-bound structured bridge errors, and softens interactive CDP doctor diagnostics.
- M1.2.3 replaces assistant-count checkpoints with outgoing-user causal identity, exact conversation binding, per-poll message re-querying, and recoverable send-side-effect semantics.
- M1.2.3 final hardening applies the full origin guard to every recovery candidate and treats post-click identity observation failure as an ambiguous send outcome.
- M1.2.4 finalizes the verified Playwright CLI sandbox contract and replaces unavailable host timers with `page.waitForTimeout`.

## Frozen contract

The Codex-visible interface is `send`, `wait`, `attach`, `detach`, and `doctor`. Transport implementations are Extension, channel CDP, raw CDP, managed installed Chrome/Edge, and bundled Chromium. Browser internal state—including snapshots, DOM, accessibility trees, browser storage, and chat history—is never model context. Callers receive only final assistant text, structured status, or sanitized errors.

M2 and M3 must depend on `BrowserAutomationSession`; they must not call Playwright selectors or transport-specific CLI operations directly.

Browser Bridge architecture is frozen. Future changes are limited to security defects, confirmed ChatGPT UI compatibility defects, confirmed Playwright compatibility defects, confirmed browser/session lifecycle defects, and regression fixes against this Frozen contract.

M2 and M3 convenience is not a reason to bypass or reshape this boundary. They must not expose DOM, snapshots, accessibility trees, browser storage, raw Playwright CLI output, or browser polling to Codex or another LLM.

## Native acceptance gate

The acceptance procedure is documented in [the manual existing-browser E2E](../manual-existing-browser-e2e.md).

Baseline finding (2026-09-01): Channel CDP successfully attached to the normal Chrome profile and enumerated its existing tabs, but `run-code` exposed neither `URL` nor `globalThis.URL`. This caused the pre-M1.2.2 matcher to reject every page.

Post-fix diagnostic result (2026-09-01): attach returned `existing-channel-cdp` and login-state validation succeeded against the existing Chrome session, confirming the sandbox origin fix. An intermediate `send` returned `PLAYWRIGHT_CLI_TIMEOUT`; subsequent compatibility work resolved the identified sandbox limitations.

The final acceptance gate required two consecutive real Channel CDP `send -> wait` rounds anchored by version-2 message IDs, followed by detach with the normal Chrome profile, tabs, and login state intact.

An intermediate attach attempt required Chrome's interactive remote-debugging authorization. The first invocation could report unavailable; after the user approved access, retrying attach succeeded. This is recorded as expected interactive authorization UX, not an M1 blocker.

## Final native acceptance evidence

Environment: Windows 10, normal daily Chrome profile, existing ChatGPT login and conversation, multiple existing tabs, interactively authorized remote debugging, and official Playwright CLI Channel CDP transport.

- Attach returned `existing-channel-cdp` and reused the existing profile, login, conversation, and tabs.
- Round 1 sent `Return exactly: CODEX_DUET_E2E_ROUND1_OK`; send reported `Message sent.` and wait returned only `CODEX_DUET_E2E_ROUND1_OK`.
- Its version-2 checkpoint contained the exact `conversationUrl`, `outgoingUserMessageId`, `previousAssistantMessageId`, and `sentAt`; it contained no prompt text, assistant text, or `assistantCount`.
- Without reattaching, round 2 sent `Return exactly: CODEX_DUET_E2E_ROUND2_OK`; send reported `Message sent.` and wait returned only `CODEX_DUET_E2E_ROUND2_OK`.
- Detach reported that the existing browser remained running. Chrome, the selected ChatGPT tab, other tabs, and login state remained intact.

This evidence satisfies the native gate and freezes M1 at the implementation baseline above.
