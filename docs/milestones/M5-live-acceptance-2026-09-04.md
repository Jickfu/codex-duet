# M5 live acceptance — 2026-09-04

Status: real generated-task LOCAL end-to-end acceptance completed through DONE, including bounded format repair and an explicitly authorized conversation handoff. Temporary service stopped cleanly. The [M5 freeze record](M5-remote-development-freeze.md) defines the accepted development scope; the chronological failures below are preserved as evidence.

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

## Authorized format-repair follow-up

The user approved the bounded format-repair recommendation. [ADR-027](../adr/ADR-027-local-format-repair.md) defines the conservative CODEX_BROWSER implementation and unchanged-content check. The first correction was sent once in the original conversation, with repair operation `85b127372ae3a80dd6e15b55f5ca6812d946df42ca9a3ff1c8f70e48944276b0` and outbound SHA-256 `bd338afe238dda4142aa86812a82fcf4a10be3aa40b6b11bd6ee6c9b68fd4402`.

ChatGPT returned a protocol code block with valid quote escaping. The block text was saved unchanged; its SHA-256 is `7ebac82b22edbcd4a308e74a92aa85cdc94d93f470d55a92773673b782961ba0`. The decoded result matched the rejected reply character for character. The repaired Browser proof was independently recorded, and standard lifecycle ingress returned ACCEPTED for the original control at `2026-09-04T04:12:46.073Z`. The original malformed reply was not replaced.

After begin-execution, only generated `greeting.mjs` changed to append one exclamation mark. The unchanged `node test.mjs` printed PASS and exited zero; diff whitespace validation passed. Snapshot `e742ec2c93b6144c52ceee47142b2266b0a1e14fbaf203c3ed36b5b4b3acc99d` received exact test/execution evidence and was formally prepared for review. Lifecycle is now EXECUTED, iteration 1, confirmed=false. Real remote Reviewer acceptance remains pending reconnection to a new service lifetime.

Implementation validation: typecheck, lint, build and the complete serial suite passed: **54 files, 536 passed, one platform skip (537 total)**. The live first-attempt repair also passed. Broader ambiguous syntax and PLAYWRIGHT_CLI format repair are not claimed.

## Reviewer reconnection observation

The user approved new request `40776dfe-98b6-4739-876b-78634be8f545` for the same task and read-only lifetime. Token exchange returned 200. New development app `asdk_app_6a9a4674a9888191b1b1ef5bf74fad66` initially showed no actions; the public Refresh action populated the eight read tools.

The original conversation's plugin menu did not offer this new app, including after reload and a search for `审查`. A fresh unsent conversation using the same search did show `Codex Duet M5 审查验收`. This is an observed UI availability difference, not proof of a universal ChatGPT restriction. No message was sent in the fresh conversation, and the task binding was not changed.

Reviewer operation `36dc1d42b76fb1290a416c0e465dcb7e298125909897c9cf83eb53c8707f7dda`, outbound SHA-256 `d96e8887fefcd22d2fb44d86f382e460f66194f98dca999fc4b839d4fd965fbe`, remains PREPARED (never ATTEMPTED). LOCAL remains EXECUTED, iteration 1, confirmed=false. Remote review has not passed. A controlled conversation handoff or a verified way to make the new connection available in the bound conversation is required before continuing; do not reset/recreate the task or silently rebind it.

## Authorized conversation handoff

The user explicitly approved controlled migration. Implementation commit `d5f6bad` and [ADR-028](../adr/ADR-028-local-reviewer-conversation-handoff.md) restrict it to the exact unsent LOCAL Reviewer. Validation passed typecheck, lint, build and the complete serial suite: **55 files, 547 passed, one platform skip (548 total)**. The subsequently extended real-Git CLI integration test also passed all five cases, including migration before Reviewer confirmation and normal lifecycle acceptance.

A fresh conversation selected the already-authorized app and received a minimal bootstrap requesting only READY, without review instructions or lifecycle authority. The UI showed READY at `https://chatgpt.com/c/6a9a4ac2-4db4-83ee-a710-033c2e113ad8`. Bootstrap attempt/result artifacts remain under the fixture `.chatbridge` directory.

`local reviewer-handoff` exclusively recorded both bindings and exact pre-handoff lifecycle bytes before switching. The Reviewer operation ID, prepared timestamp and outbound digest above remained unchanged. The original conversation, malformed Planner reply, accepted format repair and immutable snapshots were preserved. The original Reviewer control was filled from its artifact and compared exactly against the composer, then sent once. Browser confirmation was persisted at `2026-09-04T04:38:57.551Z`; standard `confirm-control` moved LOCAL to REVIEWING.

The new app's tool UI showed successful `read_file` against the named baseline contract; authenticated MCP responses returned 200. A separate unauthenticated public `/mcp` request returned 401. Baseline and review manifests independently show equal content hashes for every fixture file except `greeting.mjs`, including unchanged `test.mjs` and both contracts. This comparison did not change either snapshot.

## Reviewer acceptance and shutdown

The first Reviewer reply reported DONE/PASS but omitted the fixed `DONE:` section line. Its exact copied SHA-256 is `699b2d6452ec4ac70ee6e0576760083ecf08badba1de0d84cd595dd5a5d1e2e5`; standard ingress rejected it with `PROTOCOL_ERROR: Malformed C2C envelope`. The reply was preserved under the original Reviewer operation. No local response rewrite or parser relaxation was used.

Within the already-approved bounded format-only scope, ADR-027 gained an exact missing-DONE recognizer: canonical JSON, exact expected headers, full matching identity and unchanged result. Its targeted format/gate/lifecycle suite passed **30 tests**, with typecheck, lint and build also passing. Existing JSON-quoting repair controls remain byte-identical for replay.

Reviewer repair attempt one used operation `f9567e4b24a564715baffce21d0d164c4954e26124d9f02dd10d9cfd8809f529`, request SHA-256 `63c8867b4771779223d189b20f64dcc31e173b8976240ab3e28ab6632e413e4d`. ChatGPT returned a complete protocol code block. Its unchanged block text has SHA-256 `1609aa1fd5c2558238e8c16c41c05ac99689088cfe8cf9f97e18c3c0ab5fdd38`. Standard ingress accepted it for original Reviewer control `d96e8887fefcd22d2fb44d86f382e460f66194f98dca999fc4b839d4fd965fbe` at `2026-09-04T04:47:08.670Z`, after exact identity and result comparison. Final lifecycle is DONE, iteration 1, confirmed=true.

The remote Reviewer approved the snapshot-bound change and unchanged tests/contracts. This is review of the generated greeting acceptance task, not an independent code review of codex-duet's implementation. Development source was implemented and self-reviewed locally.

The foreground service received `stop` after all snapshot reads and exited zero. Its temporary grants were revoked; format repair required no further tools or authorization. No fixture reset/recreation, original-response replacement, main integration, push, or milestone freeze occurred. The completed evidence covers a development Quick Tunnel and one non-sensitive task, not production availability or all ChatGPT environments.
