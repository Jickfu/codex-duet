# M6.6 — First-use prerequisite guidance

The user approved continuing first-use guidance followed by a new-user acceptance path. This increment adds `onboard --mode github|local`, the bilingual README entrypoint and the skill's pre-task instruction. [First-use documentation](../first-use.md) explains each result and the remaining external checks.

The command checks installation, the target Git root and HEAD, mode-specific committed nonempty contract blobs, and (GITHUB only) a supported origin and clean worktree. It is local/read-only and suppresses raw Git errors. It never turns a local pass into verified credentials or Browser readiness: external checks remain REQUIRED and taskReady remains false. LOCAL retains its dirty-worktree/no-remote contract. Existing task status and recovery remain authoritative.

Three targeted integration tests cover uncommitted contracts, mode-specific readiness with dirty LOCAL work, independent failures/redaction and preservation of repository state. Typecheck, lint and canonical skill validation passed. The installed-package smoke exercises both modes' missing-prerequisite reports through the shipped launcher in addition to existing installation/preservation tests.

The runtime was built from committed source `3477b48` and has SHA-512 `sha512-y1fTntfAur48e2AuMWfOjhkd8tbMd1BEil2RUtaUdvmY/k3wCjGCfsAv9W3kjMDIvSDxdD05Y8spDt1x0zrjcg==`. The ZIP matches the ten-file skill tree at `f56a4a5`; its SHA-256 is `b92524120d5ceb74fa8f1eadb0e67f926e8a7f2c71fe2e75caa3f65b7a2f997c`.

## Hosted validation

All 12 jobs passed for `36a8745974f2a80681a05df88f1c6b1835df543b`, [Actions run 33849090023](https://github.com/Jickfu/codex-duet/actions/runs/33849090023).

Downloaded reports confirm 555 passed on Linux/macOS, and 554 passed with one platform skip on Windows. All nine package/skill jobs passed. This closeout changes only documentation and skips duplicate CI; application, workflow and archive bytes remain the tested ref.

The new-user live Planner→Executor→Reviewer acceptance is not completed by this increment. It requires a chosen target project, selected mode and actual account/browser access. The earlier generated-task M5 acceptance remains its own evidence and is not relabeled as a fresh-user installation acceptance. No Browser messages or OAuth approvals were performed here.
