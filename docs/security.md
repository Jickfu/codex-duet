# Security boundary

Codex is the executor. ChatGPT is never authorized to mutate the local workspace, execute a command, or operate Git. Browser automation neither uses private ChatGPT APIs nor automates login, reads credentials, exports cookies/tokens, or records authentication material.

The managed browser profile is isolated under `.chatbridge/profile` and excluded from Git. Normal operation stores no screenshots, DOM dumps, accessibility trees, or full chat history. Future debug artifacts must be opt-in, redacted, bounded, and kept outside published files; screenshots require a separate explicit switch.

The future LOCAL MCP boundary is permanently read-only for workspace content. Its independent sensitive-file policy must deny `.env`, key material, SSH/cloud credentials, and secret/token/password-like files by default. It must enforce canonical workspace-root containment, traversal and symlink-escape prevention, request/response limits, task/iteration validation, and state-transition validation. `submit_response` may write only internal task state outside the workspace content surface. No write, delete, shell, exec, commit, or push tool is permitted.

The GITHUB mode does not expose a local workspace or run a local bridge/tunnel. Reviews identify immutable commit SHAs.
