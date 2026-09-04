# M5 — Remote LOCAL development acceptance

Status: **FROZEN / SINGLE-USER REMOTE DEVELOPMENT SCOPE COMPLETE**, 2026-09-04.

Baseline: `ee76d039cc1354c229190e58864fddaa663c60c0`, integrated M4.
Implementation ref: `8fd8e966255c21c626e14db552939cbd331b85bd`.
Only milestone/status documentation follows this implementation ref.

Final gates: typecheck, lint, build and the complete serial regression passed on the unchanged implementation. **55 test files passed; 548 tests passed and one platform test skipped (549 total)**. The suite completed in 151.66 seconds. Documentation formatting and `git diff --check` were verified separately before closeout. Earlier partial/full-run counts in the chronological live record are historical results.

## Accepted scope

- An explicitly started, single-user foreground service with a temporary Cloudflare Quick Tunnel, pinned HTTPS resource identity and a separate authenticated JSON MCP listener.
- Local approval of the exact OAuth request, public-client registration, authorization code with S256 PKCE, one-hour task-scoped read grants, no refresh tokens, and revocation on shutdown.
- Eight bounded snapshot read tools restricted to the selected task's baseline and formal review targets. Remote `submit_response` is absent; the original loopback listener is not tunnelled.
- Owned tunnel supervision and shutdown, bounded requests and redacted diagnostics. No automatic tunnel recreation, public unauthenticated fallback or Browser replay.
- At most two independently evidenced CODEX_BROWSER format corrections for losslessly recoverable JSON quoting or the exact missing DONE section. The original reply remains immutable; identity and decoded result must match before normal ingress accepts the new reply.
- Explicit migration of an exact unsent LOCAL Reviewer to a known stable conversation, with immutable old/new binding evidence, destination reservation and recovery of interrupted publication. Attempted, uncertain and pending-response operations cannot migrate.

## Evidence

The [live acceptance record](M5-live-acceptance-2026-09-04.md) identifies the generated task, baseline/review snapshots, actual OAuth approvals, Browser operations, original failures, correction artifacts and accepted receipts. The same task reached DONE at iteration 1. Only `greeting.mjs` changed; the test and contract bytes remained unchanged. Authenticated remote reads succeeded, unauthenticated access returned 401, and explicit service shutdown exited zero.

The remote review covered the generated acceptance task. It was not an external review of the codex-duet implementation; implementation review was local, under the user's accepted development workflow.

Frozen shared C2C/state schemas, GITHUB implementation, BrowserAutomationSession and legacy TaskBrowserStore have no changes from the M4 baseline. The additive Browser interaction lock and handoff history are explicitly within this milestone's change surface.

## Limits retained

This freezes the development acceptance scope, not production hosting or availability. A temporary address changes on restart and needs a new connection/authorization. ChatGPT app availability differed between conversations during this run; automatic migration is not supported. Live acceptance covered one generated task with CODEX_BROWSER; broader provider/network/account combinations are not inferred.

Fixed domains, durable multi-user identity, refresh grants, remote response capabilities, production deployment and broader syntax repair remain outside this milestone. They require their own scope and acceptance work. The exact artifacts and the development branch are retained through fast-forward integration; no squash, reset, force push or evidence deletion is part of closeout.
