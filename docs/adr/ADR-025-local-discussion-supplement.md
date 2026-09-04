# ADR-025: One user-authorized LOCAL Discussion supplement

Status: user-approved on 2026-09-04; implemented for local verification, not an M4 freeze.

## Product rule

A primary LOCAL Discussion ending in USER_DECISION_REQUIRED may receive one explicit, in-scope user decision and open one supplemental segment of at most three rounds. Primary records remain intact. No automatic restart or third segment is allowed. A supplementary BLOCKED/FAILED outcome stops progress; CONVERGED is still required before final Planner initialization, and only a later accepted PLAN authorizes execution. Scope or requirement changes require a new task.

If primary Discussion blocks early, unused primary rounds are not replayed or appended: the supplemental segment independently has at most three rounds. Thus the task uses at most six Discussion rounds, never unlimited resets. FAILED or CONVERGED primary discussions cannot open a supplement.

## Additive persistence and identity

Original Discussion V1 schemas, round numbering, Browser operation schemas and GITHUB behavior remain unchanged. The optional LOCAL storage segment is `runs/<task>/discussion/local-supplement/`, containing one immutable `decision.json`, round-1 through round-3 request/response artifacts, and a recoverable summary. Original files remain under `runs/<task>/discussion/`.

The decision binds exact user text, scope-unchanged attestation, task/spec/policy/baseline identity, the exact blocked outbound control digest (including its terminal newline), canonical blocked response digest, blocked round/explanation and timestamp. Its self-hash is revalidated. The caller must obtain an actual user decision; the attestation is not automatic natural-language scope verification.

Supplemental controls use Discussion V1 round 1–3 and iteration 1, with the full decision in content. The first links to the original blocked response hash; later rounds link to their predecessor. Distinct content digests produce distinct Browser operation identities even when round numbers repeat. Every supplementary control is reconstructed and compared on read; all responses still require exact immutable Browser artifacts and task-aware confirmation. Primary replies cannot be ingested into the supplemental segment.

## Recovery and gates

Decision publication precedes supplemental round-one preparation. A crash between them is repaired only by the same explicit decision request; the decision is neither overwritten nor re-timestamped. Identical retry recovers the original first control, even after later rounds, without resetting history or sending. Another decision/control binding is rejected. A supplemental round or summary without its decision is not authoritative.

All writes remain under the task lock and before lifecycle execution/reviews. A decision-only crash still requires an unchanged baseline before its missing control can be created. Oversize complete controls fail before decision publication; both original and supplemental payloads retain the 8192-byte bound. Third-round CONTINUE and any fourth round are rejected.

The planning gate validates the original blocked chain, immutable decision and complete supplemental convergence, including the current recoverable summary. It does not call locking runtime methods recursively. The evidence-only reader requires no live Git runtime and cannot perform runtime operations. Once a supplement exists, original Discussion status cannot stand in for its convergence.

The accepted decision is copied into the additive LOCAL run at initialization. Planner and subsequent Reviewer controls carry its clarification and explanation, bind `discussionDecisionSha256`, and require an exact response echo. The clarification therefore does not depend on conversation recollection. Existing no-supplement control bytes remain unchanged. TaskSpec is never edited; later lifecycle BLOCKED decisions preserve the same supplementary context.

## Interface and limits

`local discussion-resume --blocked-control-sha256 <digest> --decision-file <path> --scope-unchanged` records authorization and returns supplemental round one plus its exact file path. Use `--supplement` for later discussion-prepare, discussion-ingest, discussion-status and discussion-recover operations. Without the flag, those commands retain primary-segment semantics. This explicit selection prevents an old retry from silently targeting a new segment.

No Browser message is sent by these commands. No workspace rollback, baseline reset, new-task creation, public endpoint or provider fallback occurs. CODEX_BROWSER is the supported evidence provider here; Playwright exact proof and M5 remote exposure remain separate work.
