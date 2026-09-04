# ADR-026: LOCAL Playwright exact transport proof

Status: implemented for M4 local acceptance on 2026-09-04.

## Boundary

LOCAL supports the selected `PLAYWRIGHT_CLI` through explicit `local browser-send` and `local browser-wait` commands. The existing BrowserAutomationSession implementation supplies the actual public-UI send and causal wait. No provider fallback, private API, protocol change, or change to frozen `browser.json` / GITHUB checkpoints is introduced. The legacy marker alone still cannot prove a LOCAL control.

The first send requires an explicit stable ChatGPT conversation URL, rather than implicitly adopting a historical tab or bootstrapping a blank conversation. Subsequent sends reuse that immutable binding. Connection, login and exact selection checks happen before the send intent. Conversation ownership is checked across both Browser providers and both task modes.

## Durable order and authority

Under the conversation lock and then the task lock, the sender validates the selected policy, reconstructs the current persisted LOCAL control, verifies live snapshot identity and reserves the conversation. It publishes immutable request bytes and an `ATTEMPTED` sidecar before invoking `sendMessage` once. A confirmed causal message marker is then written to the existing routing store and to the new sidecar as `CONFIRMED`.

The sidecar lives at `runs/<task>/local/playwright.json`. It binds provider, task, stable conversation, exact outbound digest, role, iteration, optional Discussion round, operation digest, timestamps and causal message IDs. Request and response artifacts live under `runs/<task>/local/playwright/<operationId>/`. Readers verify operation identity, state/marker consistency and exact artifact digests. New schemas are LOCAL-only; no legacy marker is migrated or adopted.

Any failure after durable intent, including a confirmed send whose checkpoint publication fails, leaves `ATTEMPTED`. Restart refuses every automatic send retry, even for a different control. Operators must inspect the preserved evidence; there is no automatic reset, resend, or force-confirm command. Failures before intent can be retried after their cause is resolved. Repeating a still-current confirmed control is a read-only result, not another send.

`browser-send` takes no arbitrary message file. Lifecycle state or an explicitly selected prepared Discussion round supplies the bytes. Terminal/execution states, live drift, unaccepted Discussion rounds and mismatched scope remain refused. Primary and supplemental Discussion retain separate immutable histories and operation hashes.

## Responses and recovery

`browser-wait` uses the exact confirmed causal marker, bounds output, publishes immutable response bytes, and marks `RESPONDED`. It never ingests, executes or sends. A wait timeout preserves confirmation. A response-before-checkpoint crash recovers the already-published bytes without another Browser read. Repeated completed waits return that same artifact. The usual lifecycle or Discussion ingress must still validate and accept the response.

The stored LOCAL gates read only the selected provider's proof and exact artifact. Capability-authenticated MCP responses may satisfy lifecycle ingress without fabricating Browser response evidence. A confirmed operation can be released for a different control only when the shared completion observer proves the matching MCP receipt is ACCEPTED with acceptedAt and the exact accepted response hash. A PENDING receipt cannot release it; exact authenticated replay repairs that crash window. No historical control can be automatically resent.

Locks serialize control publication, lifecycle mutation and Browser side effects. They do not make arbitrary external effects exactly-once. Long waits can cause competing commands to time out acquiring the lock; retrying a lock acquisition is not permission to retry an attempted send.

## Acceptance scope

Tests exercise both providers' primary/supplemental Discussion histories, exact gates, competing sends, unknown outcomes, checkpoint failures, artifact tampering, bounds, ownership and replay. Real Git/CLI integration reaches DONE through Discussion, Planner and two review rounds, including MCP-first acceptance and recovery from a PENDING receipt. Its external Browser boundary is a fixture, not a live ChatGPT session. Public remote MCP access and live remote LOCAL E2E remain M5.
