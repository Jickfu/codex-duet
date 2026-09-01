# M2 — GitHub Mode MVP

M2 adds the deterministic Git/GitHub data plane. It does not add the M3 orchestrator.

## Boundaries

- GitHub is the code/data plane: commits, files, diffs, documentation, and tests are reviewed there.
- Browser Bridge is only the control plane. It carries a compact C2C envelope and never carries source, diffs, repository archives, DOM state, browser storage, or credentials.
- M1 Browser Bridge remains frozen. GitHub Mode depends on the existing `BrowserAutomationSession` boundary and does not bypass or redesign it.
- `CodeProvider` is the shared data-plane boundary. M2 supplies `GitHubProvider`; a Local provider is deferred to M4.

## Task and ref semantics

One task owns exactly one program-derived branch: `agent/task-<taskId>`.

Task IDs match `^[A-Za-z0-9_-]{1,64}$`. Callers cannot supply an arbitrary task branch. Task state is stored atomically in the versioned project-scoped file `.chatbridge/tasks/<taskId>.json`.

`BASE_REF` is the full 40-character commit SHA at task initialization. It is written once and never follows `main` or a remote branch. `REVIEW_REF` is the full local `HEAD` SHA after task work. Review always means the immutable range `BASE_REF..REVIEW_REF`.

## Clean worktree and push policy

Initialization and review preparation require a clean worktree, including staged, tracked, conflicted, and untracked changes. The tool never stashes, resets, cleans, discards, or overwrites user work.

The only push shape is `git push origin agent/task-<taskId>:agent/task-<taskId>`. There is no force, force-with-lease, mirror, all-branches, default-branch, or arbitrary-refspec path. After push, `git ls-remote` must report the exact local full SHA before `REVIEW_REF` is persisted. A non-fast-forward push is blocked.

## CLI

```text
chatbridge github doctor [--task <id>]
chatbridge github init-task --task <id>
chatbridge github status --task <id>
chatbridge github prepare-review --task <id> --tests PASS|FAIL|NOT_RUN
```

`doctor` is read-only and reports Git/repository detection, the configured remote URL, repository identity, current branch, full HEAD, clean/dirty state, and optional task metadata. It does not inspect credential helpers, tokens, environment variables, browser state, or private configuration.

`FAIL` and `NOT_RUN` are valid review states. Tests are an explicit executor-supplied fact; M2 does not infer or run a project's test command.

## Offline deterministic acceptance

The integration suite uses a temporary working repository and temporary bare remote. The configured remote remains a GitHub URL while Git's test-local `url.*.insteadOf` maps transport to the bare repository. This preserves production remote validation without network access.

Manual acceptance against GitHub:

1. Begin on a clean repository at the intended base commit.
2. Run `chatbridge github doctor`.
3. Run `chatbridge github init-task --task demo` and confirm branch `agent/task-demo`.
4. Modify files, explicitly run the appropriate tests, and commit the changes.
5. Run `chatbridge github prepare-review --task demo --tests PASS`.
6. Confirm the remote task branch SHA equals `REVIEW_REF`.
7. Send the emitted compact C2C envelope through the frozen Browser Bridge.
8. In ChatGPT, review exactly the GitHub commit range `BASE_REF..REVIEW_REF`.

## Deferred beyond M2

PR creation/comments, merge, token management, Local MCP, cloudflared, automatic Codex execution, test-command inference, branch cleanup, multi-repository tasks, and the full Planner/Executor loop are deferred. M2 does not automate PRs or modify a default branch.
