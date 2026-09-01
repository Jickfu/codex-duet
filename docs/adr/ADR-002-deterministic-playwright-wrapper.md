# ADR-002: Deterministic Playwright wrapper

Status: Accepted

## Decision

Browser communication is implemented by a TypeScript Playwright wrapper, not model-driven screenshots, snapshots, or Computer Use loops.

## Consequences

Waiting consumes no model tokens and returns only the complete target payload. UI churn is localized to `ChatGPTWebAdapter`.
