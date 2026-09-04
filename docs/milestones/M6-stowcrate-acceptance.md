# M6 — StowCrate live GITHUB acceptance

On 2026-09-04 the user selected the existing `Jickfu/StowCrate` repository and GITHUB mode, then approved a documentation-only task: add `docs/CODEX-DUET.md` through real ChatGPT planning, Codex execution and ChatGPT review.

## Installed bundle and isolated baseline

The published repository ZIP was downloaded from `main`, extracted outside the target and installed with its own `install:project` command into `E:\cloud\code\StowCrate-duet-acceptance`. This was a new worktree of the real StowCrate repository; the original worktree's business changes were not staged or modified by this acceptance.

- ZIP SHA-256: `b92524120d5ceb74fa8f1eadb0e67f926e8a7f2c71fe2e75caa3f65b7a2f997c`.
- Installer returned `INSTALLED` and `doctor: PASS`.
- User-approved setup commit: `1ac7443164a98337ffb63d737e64c121884f7ad9`, on `codex/duet-acceptance-setup`, containing the skill bundle and both GITHUB contracts.
- After the setup commit, all local onboarding checks passed. External checks remained `REQUIRED` and `taskReady: false`, correctly distinguishing local checks from subsequent live evidence.

## Live task evidence

- Task: `stowcrate-duet-guide-20260904`.
- Provider: `CODEX_BROWSER`, discussion disabled; fixed before Browser sends.
- [ChatGPT planning and review conversation](https://chatgpt.com/c/6a9a7da0-8338-83e8-aee0-6e6f7231b073).
- BASE_REF: `1ac7443164a98337ffb63d737e64c121884f7ad9`.
- REVIEW_REF: `e7c2df6bd82867d1a55f7372a2a4a471cbf14e79`.
- [Cumulative GitHub range](https://github.com/Jickfu/StowCrate/compare/1ac7443164a98337ffb63d737e64c121884f7ad9...e7c2df6bd82867d1a55f7372a2a4a471cbf14e79): one added file, 84 lines, no other tracked changes.
- Branch: `agent/task-stowcrate-duet-guide-20260904`, pushed and verified by GitHubCodeProvider.
- Planner and Reviewer each used prepare → ATTEMPTED → one Send → CONFIRMED → RESPONDED → ACCEPTED. The Reviewer returned `DONE` in iteration 1; durable task state is `DONE`.
- Reviewer response SHA-256: `ba7b1944caa4a117f57d74df5b60c91d0e8760ce79f9a47777589cd6085272f8`.
- Local immutable evidence remains under the acceptance worktree's `.chatbridge/runs/stowcrate-duet-guide-20260904/`; input captures and validation notes remain in `.chatbridge/acceptance-input/`.

## Exact-commit validation

On REVIEW_REF, `dotnet build --nologo` passed with zero warnings/errors and all 10 architecture tests passed. The documented launcher, doctor, onboarding and status commands ran successfully. All six relative Markdown links resolved, code fences were balanced, and the Git diff passed whitespace and scope checks. No full business regression suite was claimed for this documentation-only change.

## First-use observations and limits

The first TaskSpec candidate hashed an in-memory LF request before Python wrote it using Windows CRLF. Initialization rejected it before task creation or Browser send. After the user requested continuation, the original request and rejected candidate were retained; a separate corrected candidate hashed actual request-file bytes and initialized successfully. Authors must hash the final bytes they will submit, not an earlier string representation.

An unbound Chrome tab lost its control connection before sending. A fresh tab in the same provider restored access; the eventual stable conversation was retained for both exchanges. During review composition, plain-text input produced doubled line breaks. Clipboard readback detected this before ATTEMPTED; a supported clipboard preformatted paste preserved the exact envelope. No ambiguous send was retried, and no bound conversation or provider was changed.

This verifies installation from the repository ZIP and one complete GITHUB task on the actual user's existing project/account. It is not an independent new user's usability study, a LOCAL acceptance, a multi-round correction test, or evidence that every host can connect. StowCrate setup and task branches remain separate from its main branch. No npm publication, GitHub Release, PR or merge was performed by this acceptance.
