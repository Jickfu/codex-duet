# M4.5m credential payload policy

Status: self-review hardening on 2026-09-04, before M4 freeze.

Base: `5a3a787` (LOCAL Playwright proof).

Final security review found that the existing explicit patterns rejected `tokens.json` and `passwords.txt` but omitted common payload names such as `token.txt` and `secrets.yaml`. The policy now covers credential payload families and explicit data extensions, including hidden/extensionless names and deployment suffixes. It continues to allow ordinary credential-related source filenames. This is not an arbitrary source-content secret scanner.

Regression coverage includes unit allow/deny cases and a real Git snapshot with tracked, deleted, changed and untracked credential payloads. Direct reads fail; manifest paths, directory listing, search, status and diff omit their names/content; ordinary source remains reviewable.

No snapshot schema is changed. Previously created artifacts are not rewritten or migrated; tightened read policy fails closed if an older surface contains a newly denied path. The change completes the default credential-payload deny requirement before implementation freeze.

Verification: targeted capture/primitives tests passed (23 passed, one platform skip). The final full serial suite passed all 48 files with 497 tests passed and one Windows/POSIX-specific skip. Typecheck, lint, build, touched-file formatting and whitespace checks passed. A documentation-only formatting warning was corrected and the formatting check rerun successfully; source and tests were unchanged during the full suite.
