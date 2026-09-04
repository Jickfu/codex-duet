# M4 — Local Read-Only MCP Data Plane

Status: **FROZEN / LOCALLY TESTABLE SCOPE COMPLETE**, 2026-09-04. M5 not started.

M4 base: `c40034f17f7074881b1fa8442ac4c2e67395d823` (frozen M3.3).

Verified implementation ref: `fe1e0dacf2f3543aa91dc8e4e83956a59d9aa7b8`. This freeze record and status documentation are the only subsequent changes.

Final local gates: `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, `pnpm test --maxWorkers=1`, touched-file Prettier and `git diff --check` passed. Full regression: **48 files passed; 497 tests passed, 1 platform skip** (498 total). Source and tests remained unchanged during the full run. Documentation formatting was corrected and rechecked separately. Frozen `src/core`, GITHUB run schemas, BrowserAutomationSession and legacy task Browser checkpoint files have no diff from the M4 base.

## Accepted local scope

M4 supports private, unpushed and pre-existing dirty Git worktrees with an existing HEAD. It does not require a remote, commit or push for LOCAL review. Codex remains the only Executor. Source and diff data stay on the snapshot-bound read-only MCP plane; compact control stays on the selected Browser provider.

- Immutable complete allowed snapshots, canonical fingerprints, exact captured-byte blobs, sandboxed paths and explicit credential-payload exclusions.
- `LocalCodeProvider` and `LocalReviewTargetV1`: baseline/current/previous review identities, immutable snapshot-bound test assertions and execution summaries, multi-round preparation/recovery and drift rejection.
- Eight bounded read tools on an explicitly started loopback MCP server library; optional exact capability-authenticated `submit_response` writes only internal task state.
- Bound LOCAL TaskSpec/contracts and compact control identity, guarded lifecycle, first-response-wins shared ingress, exact replay, execution reconciliation and cancellation.
- Both selected Browser providers, primary Discussion and the user-approved one-time supplemental segment; lifecycle BLOCKED decisions require fresh planning and cannot change TaskSpec scope.
- Additive Playwright intent/confirmation/response proof and crash handling, without changing frozen BrowserAutomationSession, GITHUB checkpoint or shared C2C/state schemas.

## Evidence map

| Requirement                                                                          | Local evidence                                                                                 |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Git capture, index/ignore semantics, dirty baselines, raw-byte diff and deny policy  | `local-snapshot-capture`, `captured-diff`, `local-primitives`, `local-workspace-service` tests |
| Immutable provider/review/test evidence and live drift                               | `local-code-provider`, `local-evidence-store`, `local-control` tests                           |
| Real loopback tool surface, request bounds and capability checks                     | `local-mcp-server`, `local-capability`, `local-mcp-lifecycle-ingress` tests                    |
| Discussion, supplemental decisions, blocking and crash recovery                      | two-provider `local-discussion`, `local-lifecycle`, `local-lifecycle-gates` tests              |
| Real Git CLI with CODEX_BROWSER evidence and actual loopback MCP                     | `local-cli` integration tests                                                                  |
| Real Git CLI with selected Playwright, two review rounds and MCP receipt recovery    | `local-playwright-cli` integration test                                                        |
| Exact transport intent, no resend on uncertainty, publication recovery and ownership | `local-playwright` tests                                                                       |
| Existing Browser/GITHUB/protocol behavior                                            | full regression including Browser fixtures and GITHUB provider/orchestration tests             |

The Browser integrations use local fixtures, not a real remote ChatGPT session. Real Git and loopback MCP are exercised. One POSIX executable-bit test is skipped on Windows, so this record does not claim a native POSIX run. No GitHub Actions run was available for the implementation branch when checked; local gate results are not presented as remote CI.

## Review and safety boundaries

On 2026-09-03 the user explicitly replaced external development review with Codex implementation and self-review. This freeze does not claim an independent ChatGPT REVIEW_PASS, and no pending external send/review was replayed or implicitly accepted. The phase records M4.5a–M4.5m preserve findings and verification history. Final self-review closed the navigation classification timing issue, Playwright exact-proof gap, pending-MCP-receipt release window and credential payload filename gap.

Earlier snapshot/review artifacts are not rewritten, rebased or migrated. Denied paths fail closed; the deny policy is not a source-content secret scanner. Test evidence is a caller assertion tied to a verified snapshot, not proof that the MCP server ran tests. Arbitrary external Executor effects have no exactly-once guarantee. An uncertain Playwright attempt remains non-retryable; there is no automatic force-confirm/reset operation.

The M4 server is an explicit loopback library, not a managed daemon or automatic credential distributor. The local-machine trust boundary is not a public authentication boundary. Public endpoint lifecycle, remote authentication, cloudflared and live remote ChatGPT LOCAL E2E remain M5 and were not started.

## Integration rule

After final local gates pass, preserve reviewable commits and integrate by fast-forward only. Verify remote main matches the frozen commit, then delete only the merged `codex/m4-local-readonly-mcp` implementation branch. Preserve all existing successful acceptance branches. A divergence, remote rejection or unexpected worktree change stops integration rather than forcing it.
