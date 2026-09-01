# GITHUB mode (planned M2)

GITHUB mode runs no Local Bridge and no cloudflared tunnel. ChatGPT reads through its GitHub integration; Playwright carries control messages both ways. Codex modifies, tests, commits, and pushes on a task branch.

An `EXECUTED` review request identifies repository plus immutable `BASE_REF` and `REVIEW_REF` commit SHAs. Branch names alone are not review identities. M0/M1 does not implement GitHub automation.
