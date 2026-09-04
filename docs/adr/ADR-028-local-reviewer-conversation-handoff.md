# ADR-028: Explicit handoff of an unsent LOCAL Reviewer

Status: accepted for M5 development, 2026-09-04. The user approved a controlled conversation migration after the replacement remote app appeared in a fresh ChatGPT chat but not in the bound acceptance chat.

## Scope

`local reviewer-handoff --task <id> --from <stable-url> --to <stable-url> --reason <text>` records an explicitly authorized change. It never sends. Only CODEX_BROWSER, validated LOCAL `EXECUTED`, `confirmed=false`, and the exact PREPARED REVIEWER control are eligible. GITHUB runs, mixed provider bindings, Planner/Discussion, attempted/uncertain sends, confirmed sends and received responses are ineligible. One immutable handoff per operation; no automatic migration on reconnect.

The operator creates a fresh conversation with the replacement app selected. A minimal bootstrap may establish its stable URL, but must not contain the Reviewer control, request code review, or create lifecycle authority. Once its exact URL is observed, run the handoff command, then use the normal attempted/confirmed/received Browser flow with the unchanged Reviewer control. The control already contains full task semantics and immutable review identity, so conversation recollection is not authority.

## Evidence and recovery

Before changing the active checkpoint, exclusively publish `runs/<task>/codex-browser-handoffs/<operationId>.json`. It contains both complete transport checkpoints, exact LOCAL run bytes and the reason. The only checkpoint difference is the conversation URL; operation ID, timestamps, control digest and PREPARED state remain unchanged. The original lifecycle file, snapshots, tests, response artifacts and repair records remain untouched.

Task locking serializes handoff with Browser prepare/attempt/complete/receive and lifecycle changes. The existing global conversation lock protects destination reservation. Both old and new URLs stay in reservation history. An intent-only crash blocks ordinary Browser operations; repeating the exact handoff recovers it, whereas changed arguments or lifecycle evidence fail closed. No send replay or response reassociation is inferred from the journal.

This is a narrowly authorized M5 extension, not a general conversation editor. A second destination for the same operation, post-send migration, automatic blank-chat binding, and other provider support require a separate decision. M5 remains unfrozen until live acceptance is complete.
