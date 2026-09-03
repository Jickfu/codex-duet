# ADR-021: LOCAL Discussion production and recovery

Status: implemented for CODEX_BROWSER; live Browser acceptance remains pending.

## Task and round identity

LOCAL Discussion runs before lifecycle initialization using the bound TaskSpec, baseline contracts and explicit interaction policy. It reuses DiscussionControlV1, DiscussionResponseV1 and the existing immutable round artifact paths. GITHUB Discussion behavior is unchanged.

The command requires an explicit round (1–3). Its content contains the exact LOCAL context, accepted task semantics, a trimmed question and architecture-only instructions. The complete serialized control, including its terminal newline, must fit 8192 UTF-8 bytes. The request fingerprint binds that complete content. Later rounds bind the canonical previous response fingerprint.

Only CONTINUE allows another round. A pending response, CONVERGED, USER_DECISION_REQUIRED or FAILED prevents a new round; CONTINUE at round 3 is rejected. Creating new controls or accepting new responses after a LOCAL/GITHUB lifecycle exists, or after provider reviews exist, is forbidden. Identical recovery of already-published rounds remains possible without creating a new send.

## Browser and live-state gates

Before a new request is published, lock the stored policy and verify the unchanged baseline. Before a new response is accepted, require the exact immutable Browser response bytes, the current RESPONDED record, matching operation ID, kind, iteration, round, outbound/inbound hashes and a stable conversation. Then recheck baseline equality. Missing or divergent evidence is never converted into a successful response.

Both controls and responses are bounded to 8192 UTF-8 bytes. Oversize or malformed input fails before its immutable round artifact is published. Existing CODEX_BROWSER interaction commands prepare, attempt, confirm and receive the returned control file; the Discussion commands do not send anything.

## Crash recovery authority

Immutable request.json and response.json files determine the accepted round history. The mutable summary is only a projection. A request published before its summary is recovered by repeating the same explicit round and question. A response published before its summary is recovered from its immutable response and Browser artifact. Neither case allocates another round or replays a send.

`discussion-status` derives validated state without writing. `discussion-recover` publishes the derived summary. A missing or stale summary prefix is recoverable; a summary claiming unproven responses, inconsistent identity or additional rounds is rejected. Round gaps, orphan responses and artifacts after a terminal outcome are rejected. A Browser response artifact alone is not accepted Discussion state: response.json must also exist.

Historical response replay compares the exact original raw bytes even though durable response and summary fingerprints use canonical JSON. It does not depend on the Browser still pointing at that round, and does not require the current workspace to equal an old snapshot; it cannot authorize new work.

## Remaining boundary

USER_DECISION_REQUIRED remains BLOCKED; there is no automatic user-decision substitution or reset. Failed/blocked discussion restart and lifecycle blocked/cancelled recovery need separate explicit contracts. Playwright exact-send proof, capability-scoped MCP lifecycle wiring, execution reconciliation and real Browser acceptance still precede M4 freeze. This change performs no live web send or public exposure.
