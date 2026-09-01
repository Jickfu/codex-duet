# LOCAL mode (planned M4/M5)

LOCAL mode is for unpublished workspaces. Codex sends `INIT`/`EXECUTED` through Playwright. ChatGPT reads code through a future remote MCP backed by the read-only Local Bridge and calls `submit_response`; the bridge persists the validated event and wakes Codex. Codex does not browser-poll for the reply.

The workspace surface remains permanently read-only and subject to the controls in `security.md`. No MCP or tunnel implementation ships in M0/M1.
