# ADR-011: Codex Desktop as Outer Orchestrator

## Status

Accepted for M3.0 implementation.

## Context

ADR-010 freezes the shared Browser Control Plane and mode-specific Data Plane architecture. M3 needs a primary user-facing orchestrator without introducing a second Executor or a parallel orchestration engine.

## Decision

Codex Desktop is the primary outer orchestrator and the sole workspace Executor. The repository-local `codex-duet` Skill supplies orchestration policy, while the deterministic `chatbridge` core supplies lifecycle, Git, and Browser safety primitives. ChatGPT Web acts only as Planner, Architect, and Reviewer.

The primary product mode requires neither Codex CLI nor a Codex SDK. A headless SDK mode is a future optional capability and must not change the primary roles, shared state machine, Browser Control Plane, or provider boundaries established by ADR-010.

## Consequences

- The running Codex Desktop agent inspects, edits, tests, stages, and commits.
- The Skill composes Frozen M1 `send`/`wait` and Frozen M2 `GitHubCodeProvider`; it does not duplicate their internals.
- M3.0 implements one automatic GITHUB round and durably records a reviewer-requested next PLAN without executing iteration 2.
- Desktop discovery and end-to-end behavior require manual acceptance in a real user environment.
