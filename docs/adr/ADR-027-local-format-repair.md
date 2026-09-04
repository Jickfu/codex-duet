# ADR-027: Bounded, lossless LOCAL response format repair

Status: accepted for CODEX_BROWSER lossless format correction on 2026-09-04; JSON quoting and the subsequently observed missing DONE section are supported.

The user authorized at most two independently evidenced format-correction exchanges. Original controls, rejected replies and lifecycle identities remain unchanged. A repaired reply must pass ordinary LOCAL identity, snapshot, state, transport and ingress gates before execution. This is an additive post-M4 association between an explicit repair transport control and its original lifecycle control; it does not relax C2C schemas or fabricate Browser evidence. GITHUB, shared transitions, MCP ingress and PLAYWRIGHT_CLI behavior remain unchanged.

## Conservative eligibility

The implementation addresses the observed invalid JSON result-string quoting. The envelope and full identity must already be valid, content must fail JSON parsing, and an identity-then-result shape must permit exact raw result extraction. Ambiguous backslashes, multiline strings, apparent extra JSON fields, malformed headers, wrong identity, valid JSON, BLOCKED/FAILED, and correction PLAN iteration changes are refused. No tolerant JSON parser or locally repaired response is used.

The corrected result must decode to exactly the original raw result, character for character. Claiming that meaning was preserved is insufficient. Broader syntax support requires an equally lossless check; unclear intent still requires the user.

The real Reviewer later returned valid canonical JSON and the exact expected headers but omitted the single `DONE:` section label. Within the already-authorized two-attempt format-only scope, this case now has a separate conservative recognizer: only an EXECUTED LOCAL control, its exact serialized headers with STATE DONE, and canonical JSON with exactly identity/result are eligible. The identity must match the original control. Duplicate keys, alternate JSON encodings, different headers and other missing sections are refused. The recognizer extracts meaning only; ChatGPT must return the corrected envelope. Original JSON-quoting repair request bytes remain unchanged for durable replay. No shared parser is relaxed.

## Persistence and gates

`local format-repair-prepare --task <id> --attempt <1|2> --message-file <rejected>` owns the task lock and checks live snapshot state. It requires CODEX_BROWSER, a confirmed PLANNING/REVIEWING run and the exact immutable RESPONDED artifact for the original control or previous repair. Missing, attempted or unknown send evidence cannot start a repair. No provider fallback occurs.

Records reside in `runs/<task>/local/format-repair/<original-control-sha256>/`. Each `<attempt>.json` stores the original control, rejected reply, digests and validated Browser proof. `<attempt>.request.txt` is a deterministic 8192-byte-bounded request containing the original texts as quoted data and format-only instructions. Both files use exclusive publication and exact replay. A crash between record and request publication recovers the same request without sending. Later attempts require a complete prior response and unchanged content/identity; attempt three is refused.

Existing Codex Browser prepare/attempt/complete/receive commands own every send and response, with independent operation IDs and raw artifacts. Repeated preparation only returns the existing artifact; it does not authorize another send. Unknown send outcomes still stop.

Ingress validates the complete rejected-response chain, unchanged result, same conversation and current repair operation's confirmed send and exact response artifact. It associates this proof with the original lifecycle control digest. Standard identity checks, state transitions and exact accepted-receipt replay still apply. Preparation and correction do not grant execution.

## Operation

1. Preserve the bad reply with normal Browser receive; ordinary ingestion rejects it before reserving a pending ingress receipt.
2. Prepare attempt one and send the exact `controlFile` through CODEX_BROWSER with the same role, iteration and conversation. Do not call `local confirm-control` for the repair: the original lifecycle control remains confirmed.
3. Record the new Browser response and use normal `local ingest-response`. Preserve protocol code-block text exactly; do not rewrite JSON.
4. Only another eligible syntax failure with unchanged raw result permits attempt two. A semantic change, ambiguous failure or exhaustion stops.
5. After accepted ingress, resume normal execution/review. Discussion and Playwright repair are outside this implementation.

Tests cover real stored-gate/lifecycle acceptance, execution refusal before acceptance, exact ingress replay, exhaustion, skipped attempts, attempted-send refusal, immutable recovery, historical-byte tampering, changed content/identity and unsupported providers.
