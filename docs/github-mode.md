# GITHUB mode (M2 MVP — Frozen)

Frozen implementation baseline: `f4b1dd012f79b8a6522f56d40d46f7af39a14923`

GITHUB mode runs no Local Bridge and no cloudflared tunnel. ChatGPT reads through its GitHub integration; Playwright carries control messages both ways. Codex modifies, tests, commits, and pushes on a task branch.

An `EXECUTED` review request identifies repository plus immutable `BASE_REF` and `REVIEW_REF` commit SHAs. Branch names alone are not review identities. M2 implements the safe task-branch, verified-push, persistence, CLI, and compact-envelope primitives described in [the milestone](milestones/M2-github-mode.md).
