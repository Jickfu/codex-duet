# ADR-004: ChatGPT local workspace access is permanently read-only

Status: Accepted

## Decision

Future LOCAL MCP exposes bounded read/query/status tools only. `submit_response` writes internal task state but never workspace content.

## Consequences

No write, delete, exec, shell, commit, or push capability will be present. Canonical path, symlink, sensitive-file, size, identity, and transition policies are mandatory before M4 ships.
