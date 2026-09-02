# ADR-016: Immutable task interaction policy and bounded Discussion

Status: Accepted for M3.3

## Decision

Every new task persists `.chatbridge/runs/<taskId>/interaction.json` before its first Browser side effect. TaskInteractionPolicyV1 selects exactly one Browser Control Plane provider, `CODEX_BROWSER` or `PLAYWRIGHT_CLI`, and explicitly enables or disables pre-planning Discussion. The file is create-or-verify immutable. A selected provider may not fall back to the other provider. Tasks created before M3.3, with no policy file, retain the frozen Playwright path.

`BrowserAutomationSession` remains the sole Playwright/browser-transport control plane. `CODEX_BROWSER` is a separate Codex Desktop agent handoff and does not implement or replace that interface. Its durable checkpoint records outbound identity before the gesture, exact conversation identity after confirmed send, response fingerprint, and `OUTCOME_UNKNOWN` when confirmation is uncertain. Unknown outcome is terminal for automatic replay.

Optional Discussion occurs only in `PLANNING`, for at most three rounds. DiscussionControlV1 and DiscussionResponseV1 are strict, separate protocols bound to task, iteration, round, provider, TaskSpec fingerprint, and request fingerprint. They never enter the normal C2C parser. Only `CONVERGED` permits the final Planner response. User decision, failure, malformed authority, or exhaustion stops fail closed.

## Consequences

Provider choice is auditable and deterministic. Existing M1-M3.2 contracts and historical tasks are not reinterpreted. Browser session internals remain hidden from models, and neither provider can silently downgrade safety to regain availability.
