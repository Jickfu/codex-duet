# M4.5g LOCAL reconciliation and cancellation

Status: implementation and self-review on 2026-09-03; M4 remains unfrozen.

Base: `e003502963edecef90566ffaed08cc95c7b32a99`.

Added EXECUTING-only `local reconcile-execution` and explicit `local run-cancel --reason`. See [ADR-022](../adr/ADR-022-local-reconciliation-cancellation.md).

## Verification scope

- Execution observation distinguishes unchanged workspace, in-progress changes and provider publication before lifecycle checkpoint; target/live drift is reported separately and run bytes remain unchanged.
- Provider identity mismatch is rejected; reconciliation creates no review target.
- Cancellation covers PLANNING, PLAN, EXECUTING, EXECUTED, REVIEWING and BLOCKED, preserves original authority, survives restart and rejects changed reasons or corrupt provenance.
- Late responses cannot advance cancellation, including cancellation between response preflight and ingress application. Historical accepted response replay remains harmless.
- Real Git CLI integration exercises unchanged/changed reconciliation and terminal cancellation refusal without commits or remotes in the fixture.
- Final unchanged-source `pnpm test --maxWorkers=1`: 45 files passed, 449 tests passed, 1 Windows/POSIX-specific skip.
- Typecheck, lint, build, changed-file formatting, whitespace checks and built command help passed.

Integration Browser messages remain fixture-recorded through the real interaction service, not live Browser E2E or external review. BLOCKED resume, exact Playwright proof, capability-scoped MCP lifecycle ingress and real Browser acceptance remain pending. Cancellation does not retract external sends or roll back edits. No M5 exposure was added.
