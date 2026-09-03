# M4.5e stored gates and lifecycle CLI checkpoint

Status: self-reviewed and verified on 2026-09-03; M4 remains unfrozen.

Base: `57902707748bc40711531a54a065acb4ea512218`.

Implemented stored CODEX_BROWSER confirmation/inbound gates, full optional Discussion evidence-chain validation, lifecycle CLI commands and LOCAL-aware conversation activity resolution. LOCAL run initialization rejects an existing GITHUB task ID; shared reservation wiring rejects ambiguous dual-mode ownership. Frozen GITHUB schemas and C2C transitions remain unchanged.

## Verification

- Prepared, attempted and unknown sends cannot confirm a control.
- Role, iteration, outbound digest, operation identity, conversation identity and exact recorded inbound bytes are checked; receive revalidates current send authority.
- Legacy Playwright proof and unwired MCP-source ingestion are explicitly rejected rather than inferred safe.
- Real Git lifecycle CLI reaches DONE using real stores and the existing interaction service, including pre-run Discussion, reservation checks, recorded Browser response replay and immutable evidence. HEAD and remotes remain unchanged.
- A convergence summary without its Browser response artifact is rejected.
- Final unchanged-source `pnpm test --maxWorkers=1`: 44 files passed, 434 tests passed, 1 platform-specific skip.
- Typecheck, lint, build, changed-file Prettier, whitespace checks and built CLI help passed.

An earlier full-suite process overlapped source/test edits and reported the new mode-conflict test against an older loaded module. It is not counted as passing evidence. Fresh targeted tests and the final full-suite run above passed after edits stopped.

## Remaining boundaries

Browser sends/responses in integration tests are fixtures recorded through the interaction service, not live web E2E or external review approval. LOCAL Discussion production CLI, Playwright exact-send proof, capability-scoped MCP lifecycle wiring, blocked/cancelled recovery, execution reconciliation and final real Browser acceptance remain. No main integration, public endpoint or M5 work is included. See ADR-020 for usage and refusal semantics.
