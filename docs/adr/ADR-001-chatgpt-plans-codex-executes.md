# ADR-001: ChatGPT plans/reviews; Codex executes

Status: Accepted

## Decision

ChatGPT is Planner/Architect/Reviewer. Codex alone changes local code, executes shell/tests, and operates Git.

## Consequences

The boundary is auditable and prevents review prompts from gaining local side effects. Plans must describe intent; execution remains independently testable.
