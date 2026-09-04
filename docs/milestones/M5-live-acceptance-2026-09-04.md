# M5 live acceptance — 2026-09-04

Status: partial interoperability demonstrated; lifecycle acceptance stopped at invalid Planner JSON. M5 remains development, not frozen.

## Environment and authorization

The user approved local authorization request `433c424b-f94b-4e86-8f01-b74c9699fb65` for the generated fixture task `m5-live-20260904`, read-only snapshots, one-hour token lifetime. The terminal recorded the decision. After restoring the original pending page (the previous agent tabs had closed), the service returned an OAuth callback, token HTTP 200 and successful MCP HTTP responses. ChatGPT displayed that `Codex Duet M5 验收` was connected. No additional grant or automatic approval was performed.

App identity: `asdk_app_6a9a3fd6776c8191a27837bfa7a912d6`. This is a development app associated with an ephemeral URL, not a permanent deployment. The temporary service was explicitly stopped after the failure below; process exit was zero and its grants were revoked.

## Immutable task and Browser evidence

- Fixture: `.chatbridge/m5-live-20260904` (gitignored, generated non-sensitive data only).
- Workspace: `ff96952a07ec15147317a1bc0f41841e681f723969beb2be10f302afc0e7a6f6`.
- Baseline: `749f7ffcad42c31f597081d93b217604403ae73625d38c02c7949f2c76d75983`.
- TaskSpec: `321621a45311a06d1b521a56db77d2955650e164c83d183cb9709ff5b5633d86`.
- Browser operation: `5c8c8dbb6fe39c931264112b6edd489c291d42799d357eae482c81985c11321f`.
- Outbound SHA-256: `b9f8264d0e2aa34c7e07aba92c32e32fa39ca756a8721b903844f6a6c3ceb9dc`.
- Inbound SHA-256: `bf309f745afe9b4464e11431b566aa6020ac715e0107c5263aeadc933f6da461`.
- Conversation: <https://chatgpt.com/c/6a9a4217-eca0-83ee-8a70-59d81fe9c628>.

The initial unbound TaskSpec input failed exact-literal validation because its raw request omitted the expected literal. Corrected input was written to separate `request-v2.txt` and `spec-input-v2.json` files before binding; the rejected inputs remain preserved. The initialized task was not recreated or reset.

The selected provider was CODEX_BROWSER with Discussion disabled for this simple fixture. The exact Planner control was hashed before a single send, visibly confirmed in the stable conversation, and confirmed through the lifecycle CLI. ChatGPT used the selected remote tools and returned a PLAN describing the greeting change. Multiple authenticated MCP HTTP 200 responses were observed. HTTP status alone does not attest to individual tool contents or tool-level error absence.

The final response was copied through the browser's public Copy response action and its session clipboard. A stale clipboard bridge initially returned no data; reloading the existing conversation restored copying without a resend. The original copied text, including its final newline, was saved unchanged and accepted as immutable Browser evidence at:

`.chatbridge/m5-live-20260904/.chatbridge/runs/m5-live-20260904/codex-browser/5c8c8dbb6fe39c931264112b6edd489c291d42799d357eae482c81985c11321f/response.txt`

## Actual failure and preserved state

The result string includes unescaped quotes around `Duet` and `Hello, Duet!`. This is present in the original copied text, not merely a rendered Markdown artifact. `local ingest-response` rejected it:

```text
Expected ',' or '}' after property value in JSON at position 501 (line 1 column 502)
```

Browser state is RESPONDED; LOCAL state remains PLANNING, iteration 1, confirmed=true. No PLAN was accepted, no execution intent was created, no source was edited and no test/review result was fabricated. Fixture Git status remained clean.

The existing immutable Browser operation cannot receive a different reply under the same operation identity. A different outbound message also cannot silently substitute for the lifecycle's bound control. Replacing the stored response, repairing its JSON locally or resetting/replaying the task is not an acceptance path.

## Decision needed

Proposed next scope: an explicit, bounded format-repair interaction attached to the same task, original control digest and rejected response digest. Preserve both original artifacts; record each new send and response independently; accept only a valid response with unchanged semantic identity. Do not grant execution or reset the lifecycle before valid acceptance. Define provider behavior and retry exhaustion before implementation; this touches the frozen control/evidence boundary and is not a remote-server compatibility tweak.

Remaining acceptance: valid Planner ingress, executor-only fixture change, exact snapshot/test evidence, real remote Reviewer ingress and complete lifecycle shutdown. The successful OAuth/MCP connection is not evidence that these remaining gates passed.
