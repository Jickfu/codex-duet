# M4.5a capture and provider self-review

Status: implementation hardening verified; **M4 remains incomplete / not frozen**.

On 2026-09-03 the user replaced external development review with execution and self-review by Codex. This record is not an independent ChatGPT review approval. The pending external review was not replayed or treated as accepted.

## Scope

Reviewed the LOCAL capture/provider/MCP implementation at `ab5542f7f17945cae91e0063bdf9d62848d454ed` and applied the following bounded repairs:

- Reject checkpoint records whose embedded task identity differs from the requested task.
- Serialize context and review preparation across provider instances with a task lock in a separate namespace from the outer lifecycle lock.
- Verify task, iteration and snapshot identity when reading persisted execution and test evidence.
- Reject runtime non-loopback MCP listen addresses before opening a socket.
- Resolve the default global ignore policy using Git's overridden `HOME` when present.
- Preserve raw captured line endings during diff generation and use Git C-style byte quoting for logical patch paths instead of JSON escaping.

Regression coverage includes concurrent preparation, foreign evidence at valid paths, an overridden HOME ignore-policy change, rejected `0.0.0.0`, control-character pathname quoting, and real Git patch application for Chinese paths, text, CRLF, binary, addition and deletion. Patch application explicitly disables automatic newline conversion to check exact bytes.

## Verification

- `pnpm test --maxWorkers=1`: 40 files passed; 410 tests passed, 1 skipped (Windows cannot exercise the POSIX untracked executable-bit case).
- Typecheck, lint, build, changed-file Prettier checks and `git diff --check` passed.
- This is a serial full-suite result, not a claim that default parallel fixture timing has been resolved.

## Remaining boundary

LOCAL lifecycle/CLI/TaskSpec/control integration, selected Browser provider and optional Discussion compatibility, crash/resume acceptance and final documentation remain required before M4 freeze. No main integration, public endpoint or M5/cloudflared work is included in this checkpoint. Historical M0–M3 contracts and review records are unchanged.
