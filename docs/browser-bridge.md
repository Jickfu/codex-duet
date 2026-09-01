# Browser Bridge

`BrowserAutomationSession` owns high-level deterministic operations. Library/CDP and official Agent CLI Extension/channel-CDP transports implement it without exposing `BrowserContext`, snapshots, or DOM output to callers. ChatGPT-specific rules have one shared source.

Locator priority is stable IDs/data attributes, semantic roles/ARIA, then structural fallback. Sending commits only after observing the new outgoing user identity. Waiting anchors the response to that user, observes streaming markers and stop controls, and returns only non-empty stable final text. An ambiguous or unfinished response fails explicitly.

## Reliable turn checkpoint

M1.2.3 replaces the non-monotonic assistant DOM count with `SendCheckpointV2`. A successful send records only the exact conversation URL, the newly observed outgoing user `data-message-id`, the previous assistant message ID when available, and a timestamp. It never stores prompt or response text. A V1 `assistantCount` checkpoint is stale and requires a new send; it is never interpreted as a fallback.

The outgoing user ID is the causal anchor. Wait binds to the checkpoint's exact conversation tab, finds the first assistant identity after that user in current DOM order, and re-queries that `data-message-id` on every streaming poll. `conversation-turn-*` values are diagnostics only. Assistant counts and long-lived message ElementHandles are not part of the production contract.

CLI send uses prepare and commit phases. A commit process timeout triggers one read-only recovery probe; a newly observed user ID completes the checkpoint without resending. If the side effect cannot be proven, `SEND_OUTCOME_UNKNOWN` is returned and callers must not retry automatically. Message IDs are validated as `[A-Za-z0-9_-]+` and are never interpolated into selectors.

The same ambiguity rule applies when click/Enter was attempted but the outgoing-ID observer fails: recovery runs exactly once, never sends again, and either reconstructs the marker or returns `SEND_OUTCOME_UNKNOWN`. Capability failure detected before click remains `CHATGPT_MESSAGE_ID_UNAVAILABLE` because no side effect occurred.

Recovery being read-only does not weaken the origin boundary. Every candidate metadata probe has its own permanently invalidating main-frame guard, validates origin before and after each DOM primitive, and aborts the entire recovery with `ORIGIN_DENIED` if a candidate escapes the allowlist. Foreign metadata is never accepted and recovery does not silently continue to another candidate after such a race.

The CLI-supplied current ChatGPT page wins for send. If it is not a ChatGPT page and multiple candidates exist, send fails with `CHATGPT_TAB_AMBIGUOUS`. Wait never falls back from its exact `conversationUrl`; a missing tab fails with `CHATGPT_CONVERSATION_NOT_FOUND`.

## M3.2a task-scoped conversation targeting

M3.2a design is Frozen; implementation is next. [ADR-013](adr/ADR-013-task-conversation-binding.md) adds deterministic task-aware routing without changing unscoped M1 behavior.

The current implementation calls `connect()` before `wait` reads workspace-global `.chatbridge/session.json`. Both Library and CLI transports can therefore perform ambiguous global tab discovery before the existing durable `conversationUrl` is used. The global file is also overwritten by every send. M3.2a replaces neither M1 nor its browser engine; it adds a task-scoped path:

```text
.chatbridge/runs/<taskId>/browser.json
  conversation URL
  binding timestamp
  task-scoped pending send identity
```

Task-aware CLI direction is:

```text
chatbridge send --message-file <path> --task <taskId> [--conversation-url <url>]
chatbridge wait --parse --task <taskId>
```

The task binding is read before browser connection. An unbound first send retains Frozen discovery and fails with `CHATGPT_TAB_AMBIGUOUS` when multiple eligible tabs exist, unless the caller provides an explicit validated bootstrap URL. Once bound, send and wait target exactly that conversation even when other ChatGPT tabs exist. If its tab is missing, the bridge opens the exact allowlisted URL in the attached authenticated context; failure returns `CHATGPT_CONVERSATION_UNAVAILABLE` and never selects another conversation.

`BrowserAutomationSession` will expose one additive transport-independent targeting primitive, conceptually `connect({ conversationUrl })`. Library/Extension/CDP, Playwright CLI, and managed-browser transports must implement identical exact-target behavior or fail closed with an explicit capability error. No transport may fall back to fuzzy tab selection.

The task sidecar is strict, atomic, path-safe, project-scoped, and gitignored. It contains no prompts, responses, DOM, screenshots, cookies, credentials, or browser storage. The existing `OriginPolicy` remains the sole URL authority. Two active tasks cannot bind the same conversation; terminal tasks release exclusivity but retain historical evidence.

Legacy `chatbridge send` and `chatbridge wait` continue to use `.chatbridge/session.json` unchanged, with no automatic migration. A task-aware wait timeout permits only retrying wait against the same task-scoped marker; it never authorizes resend.

The adapter receives an origin allowlist and validates its selected page before every DOM operation. Discovery examines URL strings only. It reuses an allowlisted ChatGPT page or creates a new tab; it never repurposes, reads, clicks, or evaluates a non-ChatGPT tab.

Screenshots are not normal transport. Real-site tests are manual and optional. Offline fixture tests model sending, delayed response creation, streaming completion, multiple messages, malformed protocol, and timeout.

M1.2 pins the official `@playwright/cli` package. CLI stdout and snapshot descriptions are captured internally; only structured bridge results escape. Official `detach` leaves external browsers and tabs running.

## CLI sandbox capability contract

Playwright CLI `run-code` is neither a web-page JavaScript environment nor a complete Node.js environment. Generated operations may depend only on the injected `page` and Page APIs reachable through its context, plus sandbox primitives verified by native Channel CDP testing: `Date`, `Promise`, `JSON`, `Math`, `encodeURIComponent`, `decodeURIComponent`, and ordinary ECMAScript built-ins such as Array, Object, String, and RegExp. Polling and navigation grace periods sleep through `page.waitForTimeout()`.

Generated operations must not depend on `URL`, `setTimeout`, `clearTimeout`, `TextEncoder`, `Buffer`, `process`, `performance`, `window`, `document`, `location`, Node module globals, or browser-page globals. This list changes only after an explicit Playwright CLI compatibility test updates the contract. Allowed origins are canonicalized in Node, then matched in the sandbox using exact origin boundaries. Results and allowlisted bridge errors use a per-operation random nonce; echoed source text cannot impersonate an error signal.

## Dependency compatibility

The Library transport and CLI transport are separate implementations of `BrowserAutomationSession`. The direct `playwright` dependency may be upgraded through the normal dependency-update workflow and must pass the offline Library transport suite. `@playwright/cli` is exact-pinned and uses its own declared Playwright dependency; codex-duet does not override or deduplicate it. CLI upgrades require the CLI taxonomy, attach/fallback, generated run-code, and manual existing-browser regression checks. The executable is resolved from the package's public `bin` metadata and validated to remain inside that package, rather than depending on an internal filename or runtime `npx`.
