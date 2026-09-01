# Browser Bridge

`BrowserAutomationSession` owns high-level deterministic operations. Library/CDP and official Agent CLI Extension/channel-CDP transports implement it without exposing `BrowserContext`, snapshots, or DOM output to callers. ChatGPT-specific rules have one shared source.

Locator priority is stable IDs/data attributes, semantic roles/ARIA, then structural fallback. Sending commits only after observing the new outgoing user identity. Waiting anchors the response to that user, observes streaming markers and stop controls, and returns only non-empty stable final text. An ambiguous or unfinished response fails explicitly.

## Reliable turn checkpoint

M1.2.3 replaces the non-monotonic assistant DOM count with `SendCheckpointV2`. A successful send records only the exact conversation URL, the newly observed outgoing user `data-message-id`, the previous assistant message ID when available, and a timestamp. It never stores prompt or response text. A V1 `assistantCount` checkpoint is stale and requires a new send; it is never interpreted as a fallback.

The outgoing user ID is the causal anchor. Wait binds to the checkpoint's exact conversation tab, finds the first assistant identity after that user in current DOM order, and re-queries that `data-message-id` on every streaming poll. `conversation-turn-*` values are diagnostics only. Assistant counts and long-lived message ElementHandles are not part of the production contract.

CLI send uses prepare and commit phases. A commit process timeout triggers one read-only recovery probe; a newly observed user ID completes the checkpoint without resending. If the side effect cannot be proven, `SEND_OUTCOME_UNKNOWN` is returned and callers must not retry automatically. Message IDs are validated as `[A-Za-z0-9_-]+` and are never interpolated into selectors.

The CLI-supplied current ChatGPT page wins for send. If it is not a ChatGPT page and multiple candidates exist, send fails with `CHATGPT_TAB_AMBIGUOUS`. Wait never falls back from its exact `conversationUrl`; a missing tab fails with `CHATGPT_CONVERSATION_NOT_FOUND`.

The adapter receives an origin allowlist and validates its selected page before every DOM operation. Discovery examines URL strings only. It reuses an allowlisted ChatGPT page or creates a new tab; it never repurposes, reads, clicks, or evaluates a non-ChatGPT tab.

Screenshots are not normal transport. Real-site tests are manual and optional. Offline fixture tests model sending, delayed response creation, streaming completion, multiple messages, malformed protocol, and timeout.

M1.2 pins the official `@playwright/cli` package. CLI stdout and snapshot descriptions are captured internally; only structured bridge results escape. Official `detach` leaves external browsers and tabs running.

Generated CLI operations run in a restricted sandbox and do not assume `URL`, Node globals, or complete browser globals. Allowed origins are canonicalized in Node, then matched in the sandbox using exact origin boundaries. Results and allowlisted bridge errors use a per-operation random nonce; echoed source text cannot impersonate an error signal.

## Dependency compatibility

The Library transport and CLI transport are separate implementations of `BrowserAutomationSession`. The direct `playwright` dependency may be upgraded through the normal dependency-update workflow and must pass the offline Library transport suite. `@playwright/cli` is exact-pinned and uses its own declared Playwright dependency; codex-duet does not override or deduplicate it. CLI upgrades require the CLI taxonomy, attach/fallback, generated run-code, and manual existing-browser regression checks. The executable is resolved from the package's public `bin` metadata and validated to remain inside that package, rather than depending on an internal filename or runtime `npx`.
