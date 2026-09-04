# M4.5l LOCAL Playwright proof

Status: implementation and self-review on 2026-09-04; final M4 freeze verification pending.

Base: `13cc5af` (M4.5k navigation guard).

Implemented [ADR-026](../adr/ADR-026-local-playwright-proof.md): additive exact Playwright proof, explicit LOCAL Browser CLI, selected-provider lifecycle/Discussion gates, and shared MCP completion observation. Frozen GITHUB and Browser checkpoint schemas are unchanged.

New verification covers persisted intent before the external send, refusal to retry unknown outcomes, marker-before-proof failure, response-before-checkpoint recovery without another Browser read, concurrent same-control sends, unchanged exact bytes, strict role/iteration/operation identity, provider/owner mismatch, live-state authority, and bounded input/output. The complete existing Discussion suite now runs against both providers, including the authorized supplemental segment.

The real Git CLI test uses the production LOCAL command composition and substitutes only the external Browser connection. It reaches DONE after Discussion, Planner and two review rounds, mixes Browser and capability-authenticated MCP response acceptance, and preserves HEAD with no remote. Self-review caught and closed a premature-next-send risk after run commit but before the MCP ACCEPTED receipt; the integration test now requires exact authenticated recovery first.

This is local fixture/integration acceptance, not a live ChatGPT send or an independent external review. No automatic server startup, capability distribution, public endpoint or M5/cloudflared work is included.

Verification: full serial suite passed all 48 files, with 496 tests passed and one existing Windows/POSIX-specific skip. Typecheck, lint, build, both new command help outputs, touched-file formatting and whitespace checks passed. The two-provider Discussion suite includes 26 tests; the dedicated proof suite includes 12; real Git/CLI integration includes the pending-receipt recovery check.
