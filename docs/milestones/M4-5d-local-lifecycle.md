# M4.5d LOCAL lifecycle core checkpoint

Status: self-reviewed and verified on 2026-09-03; M4 is not frozen.

Base: `dcca995cfef9bd22e4e406307c2bd138efe2d27b`.

Added a separate LOCAL run record and lifecycle core using the unchanged shared C2C transition table, task lock and response ingress. The core stores exact control/response bytes and revalidates their identities, hashes, plan provenance and review sequence during recovery. Transport confirmation and planning readiness require explicit injected gates; no default success path or lifecycle CLI is supplied.

## Verification

- Two-round PLAN/execution/immutable review/DONE with reconstructed service instances.
- Same-response replay across Browser and MCP; divergent response and wrong historical iteration rejection.
- Discussion-pending, unknown-send and live-drift refusal without advancing execution.
- Simulated provider publication before run commit and run commit before ingress ACCEPTED recovery.
- Iteration ceiling, terminal-state execution refusal and corrupted persisted plan detection.
- `pnpm test --maxWorkers=1`: 43 test files passed; 426 tests passed, 1 platform-specific skip.
- Typecheck, lint, build, changed-file formatting and whitespace checks passed.

Tests use controlled provider/transport fixtures for the new lifecycle. Existing real-Git provider tests also pass, but this is not a new real-Git lifecycle acceptance or real Browser E2E result. See ADR-019 for authority boundaries and remaining adapters, blocked-resume/cancellation, reconciliation and CLI work. No external review approval, main integration, message send or M5 work is claimed.
