# M4.5h LOCAL user decisions and blocked resumption

Status: implementation and self-review on 2026-09-03; M4 remains unfrozen.

Base: `4e1ff175240f0f5fd52ebbe771d118c1332fb536`.

The user approved same-task clarification with a new Planner control while preserving immutable BLOCKED history. Scope/requirement changes require a new task. Implemented `local resume-blocked` with explicit blocked control identity, exact decision file and scope-unchanged assertion. See [ADR-023](../adr/ADR-023-local-blocked-user-decisions.md).

## Verification scope

- Repeated Planner BLOCKED clarifications preserve the task, original responses and exact decision text; each new control has distinct identity and must receive confirmed PLAN before execution.
- Reviewer BLOCKED replans for N+1 against the reviewed snapshot, carries no TEST_STATUS and cannot accept DONE. Later review targets preserve cumulative snapshot history and decision identity.
- Exact decision retry preserves original publication and does not consume a newer BLOCKED or revive a terminal run. Conflicting retry, stale control, scope-change assertion, live drift, envelope overflow and iteration exhaustion fail closed.
- Reconstructed lifecycle validation rejects tampered decisions and forged response/snapshot/iteration links, including after cancellation. Existing no-decision lifecycle tests remain valid.
- Real Git CLI integration exercises both Planner and Reviewer blocking, new Browser-operation confirmation, new PLAN ingestion and two review rounds through stored interaction-service fixtures.
- Stateless project-control refuses an existing lifecycle so it cannot omit accepted clarifications.
- Final unchanged-source `pnpm test --maxWorkers=1`: 45 files passed, 454 tests passed, 1 Windows/POSIX-specific skip.
- Typecheck, lint, build, changed-file formatting, whitespace checks and built resume-blocked command help passed.

Browser records in integration are fixtures, not live ChatGPT interactions or external review. The scope assertion is caller attestation, not automated natural-language verification. Pre-run Discussion decision recovery, exact Playwright proof, capability-scoped MCP lifecycle ingress and final M4 acceptance remain separate. Remote exposure and cloudflared remain M5.
