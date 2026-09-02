# ADR-013: Task-Scoped ChatGPT Conversation Binding

## Status

Accepted and re-frozen. M3.2a implementation baseline `61f8565dda0ffc6b24c90116b648368afad1da6b` passed real Desktop blank-new-chat E2E acceptance. The earlier `7d9d31206e699d5a878f40abe23fb1aa1d82412e` remains the historical pre-dogfood baseline. The Decision is unchanged.

## Context

The current Browser Control Plane stores its latest confirmed send in workspace-global `.chatbridge/session.json`. `SendCheckpointV2` already records the exact `conversationUrl`, outgoing user message ID, optional previous assistant message ID, and send timestamp. `wait` uses the URL and outgoing ID as its causal response anchor.

That identity is applied too late. The current CLI runtime creates a browser session and calls `connect()` before `wait` reads the checkpoint. Both the Library and Playwright CLI transports perform global ChatGPT-tab discovery during connect. With multiple eligible tabs, they can return `CHATGPT_TAB_AMBIGUOUS` before the durable `conversationUrl` is available to select the correct conversation. A later task send also overwrites the single global checkpoint, so two durable tasks cannot retain independent wait anchors.

The one-ChatGPT-tab assumption and global session file therefore cannot safely support restartable multi-task orchestration. The solution must preserve Frozen unscoped M1 behavior, avoid changing the C2C schema or M3.1 checkpoint, and work identically across browser transports.

## Decision

### Identity and ownership

One non-terminal durable task binds to one ChatGPT conversation. After the task's first confirmed send returns a stable, validated conversation URL, that URL becomes the task's immutable Browser Control Plane routing identity.

Conversation binding is not a C2C field, CodeProvider state, source identity, or review identity. It does not change `BASE_REF`, `REVIEW_REF`, ADR-012, or Frozen M2. It is stored in a separate, versioned, project-scoped sidecar associated with the M3 run by `taskId`:

```text
.chatbridge/runs/<taskId>/browser.json
```

The frozen conceptual model is:

```ts
type TaskBrowserBindingV1 = {
  version: 1;
  taskId: string;
  conversation: {
    url: string;
    boundAt: string;
  };
  pendingSend?: {
    outgoingUserMessageId: string;
    previousAssistantMessageId?: string;
    sentAt: string;
  };
};
```

The implementation may refine field names but not the identity or safety semantics. The schema must be strict Zod, task IDs must use the existing path-safe validation, and writes must be atomic. The sidecar is gitignored and stores only deterministic routing metadata. It never stores prompts, responses, DOM, HTML, accessibility trees, screenshots, cookies, tokens, credentials, or browser storage.

The sidecar is preferred over a `DuetRunCheckpointV3`. M3.1 V2 lifecycle and review history are Frozen; browser routing is orthogonal to GitHub orchestration state, has an independent lifecycle, and can later be reused by LOCAL mode. Keeping `DuetRunCheckpointV2` as orchestration/data-plane state and `TaskBrowserBindingV1` as Browser Control Plane state avoids coupling a browser metadata addition to a checkpoint migration.

### Binding lifecycle and bootstrap

Conversation binding has its own lifecycle and does not add a C2C `TaskState`:

```text
UNBOUND
→ first confirmed task-aware send
→ BOUND throughout planning and review iterations
→ orchestration terminal state
→ HISTORICAL
```

An unbound task uses Frozen M1 discovery for its first task-aware send. Zero candidates may create the configured ChatGPT page, one candidate is reused, and multiple candidates fail closed with `CHATGPT_TAB_AMBIGUOUS`. The bridge never chooses by title, recency, DOM content, or visual focus. A generic new-chat route is a bootstrap surface, not a durable conversation identity. After confirmation of the outgoing message ID, the transport waits for a concrete canonical `.../c/<conversation-id>` URL before returning the marker.

After a confirmed send, the bridge atomically persists both the validated stable conversation binding and task-scoped pending-send marker. It must not persist a binding before send confirmation, and it must never persist `/` or another generic route as identity. An unknown send outcome remains non-retriable. If the message ID is confirmed but a stable identity does not appear within the bounded observation window, or the confirmed marker cannot be persisted, the bridge reports `SEND_CHECKPOINT_PERSIST_FAILED` with explicit do-not-resend semantics.

The additive CLI supports explicit bootstrap targeting:

```text
chatbridge send --message-file <path> --task <taskId> [--conversation-url <url>]
chatbridge wait --parse --task <taskId>
```

`--conversation-url` is valid only with `--task`, only while the task is unbound, and never acts as an implicit rebind. It must be an absolute concrete conversation URL without credentials, pass the existing `OriginPolicy`, contain a bounded `[A-Za-z0-9_-]+` identity in a `.../c/<conversation-id>` path, and be used as an exact deterministic target. Generic/new-chat routes are rejected with `CHATGPT_CONVERSATION_IDENTITY_REQUIRED`. A value conflicting with an existing binding fails closed. Explicit rebind UX is deferred to M3.2c.

These options extend the public `send` and `wait` Browser Control Plane primitives instead of adding duplicate `duet browser-send` or `duet browser-wait` engines. The Skill uses only this public CLI.

### Bound send and wait ordering

For a bound task, the runtime reads and validates `browser.json` before connecting to a browser session.

A bound send follows:

```text
read task binding
→ validate exact conversation URL
→ connect exactly to that conversation
→ send and confirm outgoing message identity
→ atomically replace only that task's pendingSend
```

Other ChatGPT tabs are irrelevant and cannot cause `CHATGPT_TAB_AMBIGUOUS`. A send for Task B cannot overwrite Task A's binding or pending send.

A bound wait follows:

```text
read task binding and pendingSend
→ validate exact conversation URL and message IDs
→ connect exactly to that conversation
→ wait after exact outgoingUserMessageId
```

This deliberately reverses the current connect-before-checkpoint ordering. A successful wait does not erase recovery evidence before the caller has validated and ingested the response. The marker remains usable for read-only wait recovery until a later confirmed send atomically replaces it or a future explicit acknowledgement/cleanup contract safely retires it.

### Missing target and immutable routing

The transport-independent browser API gains an additive exact-target capability, conceptually:

```ts
connect(options?: { conversationUrl?: string }): Promise<void>;
```

Without a target it preserves Frozen M1 discovery. With a target it must find the exact bound page or open a new page directly at the bound URL in the same attached authenticated browser context. The origin is checked before navigation, after navigation, and around every operation with the existing `OriginPolicy`. If navigation fails, leaves the allowlist, or does not resolve to the exact validated conversation identity, the bridge returns `CHATGPT_CONVERSATION_UNAVAILABLE`. It never falls back to another ChatGPT conversation.

Once bound, reconnect, active-tab changes, or discovery changes cannot alter the binding. Deleted or inaccessible conversations stop the task; automatic rebinding is forbidden. M3.2c may later design an explicit, auditable rebind workflow.

### Active-task uniqueness

Two non-terminal durable tasks cannot bind the same normalized concrete conversation URL. Implementations must enforce this project-wide under a lock or equivalent serialization so concurrent bootstrap writes cannot race. Concrete discovered or explicit targets receive reservation preflight before send. A blank new-chat route remains inside the same lock from selection through send, stable identity observation, final reservation check, and persistence; the generic route itself is never reserved or written to a sidecar. A conflict returns `CHATGPT_CONVERSATION_ALREADY_BOUND`; if found only after a confirmed blank-chat send, it is surfaced as `SEND_CHECKPOINT_PERSIST_FAILED` because replay is unsafe.

Terminal tasks no longer own the exclusive reservation, but their historical sidecars remain as evidence. Reusing a historical conversation for a new task is permitted only through explicit bootstrap targeting; automatic discovery must not silently recycle a historical binding. Missing or malformed run state needed to determine ownership fails closed rather than assuming the reservation is free.

### Transport independence

`BrowserAutomationSession` owns the exact-target contract. Library/Extension/CDP, Playwright CLI, and managed-browser paths must implement the same semantics. Transport-specific tab heuristics are not allowed. A transport that cannot safely target or open the exact conversation reports an explicit capability failure; it cannot fall back to global selection.

Conversation URLs are parsed and canonicalized in trusted Node code, contain no username or password, and must pass the existing `OriginPolicy`. Durable identities additionally require a concrete `.../c/<conversation-id>` segment and reject encoded or traversal-like path ambiguity. They are passed as structured data, never interpolated into shell commands. The restricted CLI operation performs the equivalent bounded path check without forbidden globals. No second allowlist is introduced.

### Post-freeze first-send stabilization correction

A real M3.2b Desktop dogfood exposed that the outgoing user message ID can appear before ChatGPT completes its SPA transition from `/` to `/c/<id>`. Both transports previously returned the page URL at that earlier instant, allowing the task layer to persist `/` and making the subsequent exact wait unavailable. The corrected confirmation boundary waits for stable concrete identity after message confirmation. Existing bound sends must still confirm the identical concrete URL; a different identity remains a confirmed-side-effect persistence failure, never an implicit rebind. Strict CLI recovery remains exact-only and may conservatively return `SEND_OUTCOME_UNKNOWN` if the process dies before stable identity is known.

### Legacy compatibility and timeout recovery

Unscoped `chatbridge send` and `chatbridge wait` continue using workspace-global `.chatbridge/session.json` with existing Frozen M1 behavior, including `CHATGPT_TAB_AMBIGUOUS`. There is no automatic migration from the legacy session into a task binding. Scoped and unscoped paths share the same browser engine.

After a confirmed task-aware send, a timeout permits only another `wait --task <taskId>` against the same sidecar, conversation, and outgoing message ID. It never authorizes resend. Process or browser restart follows the same exact-target path and opens the bound URL if its tab is missing.

### Multiple-task example

```text
Task A → conversation C1 → pending message A1
Task B → conversation C2 → pending message B1

Browser tabs: C1, C2, C3

wait --task A → only C1 / A1
send --task B → only C2
C3 → untouched
```

`duet status` may later expose only compact binding metadata such as `bound`, conversation URL, and whether a pending send exists. It must not expose message text, chat history, or DOM data.

## Alternatives considered

### Continue using global `session.json`

Rejected. It cannot preserve independent pending sends for multiple durable tasks, and its identity is read only after the current runtime has already performed ambiguous global discovery.

### Upgrade the orchestration checkpoint to V3

Rejected for M3.2a. Conversation routing is orthogonal Browser Control Plane state, while M3.1 V2 is a Frozen orchestration/data-plane contract. A V3 migration would couple independent lifecycles and reduce future reuse by non-GitHub modes without improving routing safety.

### Add `duet browser-send` and `duet browser-wait`

Rejected. `send` and `wait` remain the public Browser Control Plane primitives. Adding `--task` supplies deterministic scope while retaining one browser engine and one transport contract.

### Select a tab by title, recency, focus, or DOM content

Rejected. These signals are fuzzy or transport-dependent and can route task control messages into the wrong conversation. Bootstrap is either unambiguous discovery or an explicit validated URL.

## Consequences

Under ADR-015, conversation continuity is not TaskSpec authority. The local durable TaskSpec remains authoritative and the bound conversation is only a semantic cache; an unavailable conversation continues to fail closed with no implicit rebind.

- Durable tasks can resume and coexist without overwriting each other's Browser checkpoints.
- Exact durable identity takes precedence over ambiguous global tab discovery only for task-aware operations.
- Legacy M1 behavior and fail-closed ambiguity remain compatible.
- Frozen M0, M1 external behavior, M2, M3.0, M3.1, C2C, and review identity remain unchanged.
- The implementation needs a task-browser store, project-wide uniqueness serialization, public CLI options, pre-connect target resolution, and equal Library/CLI transport support.
- M3.2a does not implement `EXECUTING` crash reconciliation. Existing `EXECUTING → EXECUTION_RECOVERY_REQUIRED` behavior remains.
- Explicit rebind UX, cleanup commands, historical-binding management, enhanced diagnostics, and task-recovery UI remain M3.2c concerns.
- LOCAL MCP and M4 remain out of scope.

## Acceptance record

The real Desktop acceptance task `m3-conversation-binding-dogfood-20260902` completed `PLANNING → PLAN → EXECUTING → EXECUTED → REVIEWING → DONE` at iteration 1. Its immutable GitHub range was `7d9d31206e699d5a878f40abe23fb1aa1d82412e..ee0434f86bd8a70bb0aa6703b9ab8457e8793051`, with 199 of 199 tests passing. The dogfood branch remains unmerged as acceptance evidence; its review ref is not the implementation baseline.

With C1 as the explicit task conversation and unrelated C2/C3 open, bootstrap and Planner wait targeted only C1 without ambiguity. Closing C1 before review send caused an exact C1 reopen without rebind; closing it again before Reviewer wait caused another exact reopen without message replay. The canonical binding and original `boundAt` remained unchanged, confirmed review send replaced only the task-scoped pending marker, and the legacy global SessionStore remained byte-identical. C2/C3 were not selected, used as fallback, rebound, or inspected for routing.

Public acceptance evidence intentionally omits the real conversation URL, message IDs, timestamps, and other user-specific Browser routing identifiers. Those values remain only in local gitignored `.chatbridge/runs/<taskId>/browser.json` evidence.
