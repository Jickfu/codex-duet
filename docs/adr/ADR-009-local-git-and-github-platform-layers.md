# ADR-009: Local Git and GitHub Platform are separate capability layers

## Status

Accepted for M2 boundary cleanup.

## Decision

Local repository state and Git transport remain deterministic operations performed through the centralized `GitRunner` and system Git CLI.

GitHub Platform features form a separate future capability boundary:

- pull-request creation and lookup
- checks and workflow status
- comments
- platform metadata

No GitHub Platform backend is selected or implemented in M2. Future candidates include a structured Codex GitHub plugin/skill, `gh`, and GitHub REST adapters.

## Rationale

Status, HEAD identity, branch operations, commit ancestry, push, and remote SHA equality are correctness-critical primitives with stable machine-readable Git behavior. Replacing them with an LLM-driven natural-language exchange would weaken determinism, error classification, and security review.

Platform features have different authentication, API, and lifecycle concerns. Keeping them separate lets a future structured backend evolve without changing M2 task-branch or immutable-ref semantics.

## Consequences

- `GitHubCodeProvider` names a code-context provider, not a GitHub API adapter.
- A future plugin may implement or support GitHub Platform capabilities but does not replace Local Git.
- A plugin is eligible as deterministic infrastructure only when it exposes stable structured tool calls and results. Otherwise it remains an Executor capability.
- M2 adds no PR automation, plugin integration, `gh`, REST, or token management.
