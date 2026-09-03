# M4.5i LOCAL authenticated MCP lifecycle integration

Status: implementation and self-review on 2026-09-03; M4 remains unfrozen.

Base: `cfd888559ac48ce7c04ffb7f9af811a5a96982c7`.

Connected explicitly enabled loopback MCP submission to the guarded LOCAL lifecycle and shared response ingress. Added request-local reauthentication and completion observation without fabricating Browser inbound evidence. See [ADR-024](../adr/ADR-024-local-mcp-lifecycle-ingress.md).

## Verification scope

- Real Git plus real localhost MCP integration covers new PLAN, Reviewer BLOCKED, user clarification/replanning and DONE across two review rounds.
- Invalid credentials and malformed C2C fail without reserving ingress; task/control/iteration and source mismatches are refused.
- PREPARED, ATTEMPTED and OUTCOME_UNKNOWN send states cannot be bypassed with a capability.
- Live drift and cancellation still block acceptance; credentials are checked again inside shared application locking.
- Browser-first and MCP-first results retain first-response-wins and exact cross-source replay.
- Simulated PENDING after run commit does not release the Browser operation; exact authenticated retry completes acceptance. Browser stays CONFIRMED with no invented inbound digest/artifact, and the same completed control cannot be resent.
- Capability record/path identity is checked; secrets are absent from run/ingress results.
- Final unchanged-source full serial rerun: 46 files passed, 462 tests passed, 1 Windows/POSIX-specific skip.
- Typecheck, lint, build, changed-file formatting and whitespace checks passed.

## Regression observation

The first full serial run passed all new tests but failed the existing Browser test `uses a document-bound composer so navigation between fill and send cannot click foreign DOM`: expected ORIGIN_DENIED, received Playwright execution-context-destroyed. The unchanged Browser suite then passed all 32 tests in isolation. The existing guard uses a bounded 25 ms delay before rechecking origin after context destruction; this is a timing-sensitive error-classification observation, not a demonstrated foreign-DOM action. No Browser adapter implementation or test expectation was changed in this stage. Keep this observation visible alongside the final full rerun result rather than treating the initial run as PASS.

Browser interactions remain fixtures recorded through the actual interaction service; no live web send or independent external review was performed. Explicit library composition is implemented, not automatic capability distribution or a server-management CLI. Pre-run Discussion decision recovery, exact Playwright proof and final M4 acceptance remain separate. No M5 public exposure was introduced.
