# ADR-003: Mode-specific data planes, shared protocol

Status: Accepted

## Decision

LOCAL uses a future read-only Local MCP data plane; GITHUB uses the ChatGPT GitHub integration. Both share C2C/1 and its state machine.

## Consequences

Local-only projects need not be published, hosted projects need no local tunnel, and provider mechanics cannot leak into lifecycle semantics.
