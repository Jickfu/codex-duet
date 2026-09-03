# ADR-020: Stored LOCAL gates and lifecycle CLI

Status: implemented for CODEX_BROWSER evidence; real Browser acceptance pending.

## Stored authority

`StoredLocalLifecycleGates` replaces permissive test fixtures in the CLI. It checks the exact stored interaction policy and locks it, verifies the bound LOCAL TaskSpec and baseline contract blobs, and checks optional Discussion before initializing a run. A CONVERGED summary alone is insufficient: all sequential rounds must bind the task, provider, TaskSpec, policy, request/response hashes and previous response. Each round must also have the matching immutable Codex Browser response artifact. Missing, divergent or incomplete evidence fails closed.

Control confirmation requires the selected CODEX_BROWSER provider, exact task, role, iteration, outbound digest, recomputed operation identity, stable conversation URL, and CONFIRMED or RESPONDED state. PREPARED, ATTEMPTED and OUTCOME_UNKNOWN are not confirmation. Ingestion additionally requires RESPONDED, the exact inbound digest and byte-identical persisted response artifact. The lifecycle rechecks these gates under shared ingress locking; historical identical replay continues to use its saved accepted response identity.

The legacy PLAYWRIGHT_CLI task marker lacks an outbound digest, so this adapter rejects it with LOCAL_TRANSPORT_PROOF_UNAVAILABLE. It never changes the selected provider. Capability-scoped LOCAL MCP response wiring is not yet supplied; new MCP-source ingestion through this adapter is rejected. Neither gap is bypassed by accepting a manually supplied success flag.

## CLI and reservations

Added `local run-init`, `run-status`, `confirm-control`, `begin-execution`, `run-prepare-review` and `ingest-response --message-file`. These commands do not send messages or run tests. They invoke lifecycle-owned task locks directly rather than acquiring a nested copy of the same lock.

Existing Codex Browser interaction commands can consult LOCAL activity through an optional activity resolver in the shared reservation service wiring. A validated bound pre-run LOCAL task remains active while Discussion is pending; a persisted run's validated state becomes authoritative once present. A task ID with both GITHUB and LOCAL ownership is refused. LOCAL initialization also refuses an existing GITHUB run ID. Default callers without a resolver retain the previous GITHUB behavior.

Use the exact lifecycle `control` string when preparing a Browser operation. Adding a final newline changes its digest. `confirm-control` validates the already-recorded send; it does not perform or retry a send. Record the exact returned Browser response through the existing interaction service before invoking `ingest-response`.

## Acceptance boundary

Real Git integration covers bound semantics, Discussion evidence, existing interaction-service preparation/attempt/confirmation/receive, lifecycle CLI, exact response replay, immutable snapshot evidence and DONE without commits or remotes. These Browser events are fixture-generated: no live web send or ChatGPT review was performed.

LOCAL Discussion request/response production still needs its own task-aware CLI adapter rather than the existing GITHUB-only Discussion service. Playwright exact-send proof, MCP ingress wiring, blocked/cancelled recovery, execution reconciliation and real Browser end-to-end acceptance remain before M4 freeze. Public exposure remains M5.
