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

M3.2a is **Frozen / Desktop E2E PASS** at implementation baseline `7d9d31206e699d5a878f40abe23fb1aa1d82412e`. [ADR-013](adr/ADR-013-task-conversation-binding.md) adds deterministic task-aware routing without changing unscoped M1 behavior.

Before M3.2a, `runtime()` called `connect()` before `wait` read workspace-global `.chatbridge/session.json`. Both Library and CLI transports could therefore perform ambiguous global tab discovery before the existing durable `conversationUrl` was used, and the global file was overwritten by every send. M3.2a replaces neither M1 nor its browser engine; it adds a task-scoped path:

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

The task binding is read before browser connection. An unbound first send retains Frozen discovery and fails with `CHATGPT_TAB_AMBIGUOUS` when multiple eligible tabs exist, unless the caller provides an explicit validated bootstrap URL. A discovered blank new-chat route such as `https://chatgpt.com/` is only a bootstrap surface: after the outgoing message ID is confirmed, both Library and Playwright CLI transports wait for a concrete canonical `.../c/<conversation-id>` URL before returning the send marker. Once bound, send and wait target exactly that conversation even when other ChatGPT tabs exist. If its tab is missing, the bridge opens the exact allowlisted URL in the attached authenticated context; failure returns `CHATGPT_CONVERSATION_UNAVAILABLE` and never selects another conversation.

When discovery already selects a concrete conversation, the first-send reservation preflight and exact re-pin still occur before login, prepare, or send. A blank new-chat route is re-pinned as the serialized bootstrap surface but is not treated as a durable reservation identity; the final concrete URL is checked for reservation conflicts after confirmation and before persistence. Playwright CLI recovery remains strict to the prepared conversation and never accepts a newer user message from another ChatGPT candidate. If its process dies before the stable URL is confirmed, recovery may return no marker and the caller reports `SEND_OUTCOME_UNKNOWN`. Unscoped M1 recovery keeps its Frozen broad candidate scan for compatibility.

`BrowserAutomationSession` exposes an additive transport-independent `connect({ conversationUrl })` targeting primitive and returns the selected conversation URL before send. Library/Extension/CDP, Playwright CLI, and managed-browser transports implement identical exact-target behavior or fail closed with an explicit capability error. No transport falls back to fuzzy tab selection. The Playwright CLI session retains the selected URL across its independent login, prepare, commit, recovery, and wait operations.

Unbound bootstrap is protected by a bounded project-wide filesystem lock covering selection, applicable reservation preflight, send confirmation, final concrete reservation, and atomic sidecar persistence. Active conflicts on an already concrete target are rejected before `sendMessage`; a newly created concrete identity is checked inside the same lock before persistence. Historical concrete conversations require explicit bootstrap. A generic URL is rejected as an explicit exact target. Confirmed Browser side effects whose stable identity or task checkpoint cannot be persisted return `SEND_CHECKPOINT_PERSIST_FAILED` and never authorize resend.

A real post-freeze dogfood exposed first-send blank-chat URL stabilization. Durable binding now waits for a concrete conversation identity after confirmed send. The identity segment is bounded and limited to `[A-Za-z0-9_-]+`; credentials, encoded path ambiguity, traversal, wrong origins, `/`, and other generic routes fail closed. This additive integration fix does not add rebind, change exact-bound wait behavior, or alter M3.2b crash reconciliation.

The task sidecar is strict, atomic, path-safe, project-scoped, and gitignored. It contains no prompts, responses, DOM, screenshots, cookies, credentials, or browser storage. The existing `OriginPolicy` remains the sole URL authority. Two active tasks cannot bind the same conversation; terminal tasks release exclusivity but retain historical evidence.

Legacy `chatbridge send` and `chatbridge wait` continue to use `.chatbridge/session.json` unchanged, with no automatic migration. A task-aware wait timeout permits only retrying wait against the same task-scoped marker; it never authorizes resend.

Real existing-browser acceptance used symbolic conversations C1 (the explicit task target) and unrelated C2/C3. With all three tabs present, explicit bootstrap and the bound Planner wait targeted only C1 without ambiguity. After C1 was closed twice, the bound review send and then the bound Reviewer wait each reopened only exact C1; neither operation resent a prior message, rebound the task, or fell back to C2/C3. The canonical binding identity and original `boundAt` remained stable, the review send atomically replaced the task-scoped planning marker, and the legacy global SessionStore remained byte-identical. Real conversation URLs, message IDs, and other user-specific Browser identifiers remain local and gitignored and are not copied into public acceptance documentation.

The adapter receives an origin allowlist and validates its selected page before every DOM operation. Discovery examines URL strings only. It reuses an allowlisted ChatGPT page or creates a new tab; it never repurposes, reads, clicks, or evaluates a non-ChatGPT tab.

Screenshots are not normal transport. Real-site tests are manual and optional. Offline fixture tests model sending, delayed response creation, streaming completion, multiple messages, malformed protocol, and timeout.

M1.2 pins the official `@playwright/cli` package. CLI stdout and snapshot descriptions are captured internally; only structured bridge results escape. Official `detach` leaves external browsers and tabs running.

## CLI sandbox capability contract

Playwright CLI `run-code` is neither a web-page JavaScript environment nor a complete Node.js environment. Generated operations may depend only on the injected `page` and Page APIs reachable through its context, plus sandbox primitives verified by native Channel CDP testing: `Date`, `Promise`, `JSON`, `Math`, `encodeURIComponent`, `decodeURIComponent`, and ordinary ECMAScript built-ins such as Array, Object, String, and RegExp. Polling and navigation grace periods sleep through `page.waitForTimeout()`.

Generated operations must not depend on `URL`, `setTimeout`, `clearTimeout`, `TextEncoder`, `Buffer`, `process`, `performance`, `window`, `document`, `location`, Node module globals, or browser-page globals. This list changes only after an explicit Playwright CLI compatibility test updates the contract. Allowed origins are canonicalized in Node, then matched in the sandbox using exact origin boundaries. Results and allowlisted bridge errors use a per-operation random nonce; echoed source text cannot impersonate an error signal.

## Dependency compatibility

The Library transport and CLI transport are separate implementations of `BrowserAutomationSession`. The direct `playwright` dependency may be upgraded through the normal dependency-update workflow and must pass the offline Library transport suite. `@playwright/cli` is exact-pinned and uses its own declared Playwright dependency; codex-duet does not override or deduplicate it. CLI upgrades require the CLI taxonomy, attach/fallback, generated run-code, and manual existing-browser regression checks. The executable is resolved from the package's public `bin` metadata and validated to remain inside that package, rather than depending on an internal filename or runtime `npx`.
