# M4.5f LOCAL Discussion commands and recovery

Status: self-reviewed and verified on 2026-09-03; M4 remains unfrozen.

Base: `205b37314351c29a60e6748b4c0c18b9e10a4e8b`.

Added LOCAL discussion-prepare, discussion-ingest, discussion-status and discussion-recover. The producer reuses existing Discussion schemas and Browser artifacts while binding accepted LOCAL semantics and baseline identity. Immutable round files determine recovery; summaries cannot grant unproven progress. GITHUB Discussion code and frozen contracts are unchanged.

## Verification

- Explicit same-round request replay; different request and pending/terminal continuation rejection.
- Sequential CONTINUE to CONVERGED with previous-response hashes and exact historical response replay after the Browser advances.
- Request or response publication before summary: reconstructed service recovers the same round and repairs only the summary.
- USER_DECISION_REQUIRED/FAILED stop continuation; fourth round and third-round CONTINUE are refused.
- Oversize input and baseline drift fail before response publication; forged summaries and orphan responses are rejected.
- Real Git lifecycle integration now uses the new Discussion commands instead of manually installing convergence. It checks exact control-file bytes, Browser evidence, summary recovery and subsequent lifecycle completion.
- Final unchanged-source `pnpm test --maxWorkers=1`: 45 files passed, 441 tests passed, 1 platform-specific skip.
- Typecheck, lint, build, changed-file formatting, whitespace checks and built command help passed.

Browser interactions in integration tests are fixture-recorded through the existing service, not live web acceptance or independent external review. Blocked/cancelled lifecycle recovery, execution reconciliation, Playwright exact-send proof, capability-scoped MCP lifecycle ingress and real Browser E2E remain before M4 freeze. No new message was sent and no public/M5 transport was introduced.
