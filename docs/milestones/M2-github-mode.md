# M2 — GitHub Mode MVP

Status: **Frozen**

Frozen implementation baseline: `f4b1dd012f79b8a6522f56d40d46f7af39a14923`

M2 adds the deterministic Git/GitHub data plane. It does not add the M3 orchestrator.

## Frozen contract

1. Local Git correctness-critical operations use the deterministic Git CLI through `GitRunner`.
2. GitHub Platform capabilities are a separate future layer.
3. One task owns one generated `agent/task-<taskId>` branch.
4. A dirty worktree blocks task initialization and review preparation.
5. `BASE_REF` is the immutable full 40-character SHA captured at task initialization.
6. `REVIEW_REF` is the immutable full 40-character local `HEAD` after task execution.
7. Formal review identity is exactly `BASE_REF..REVIEW_REF`; moving refs are never formal review identities.
8. Push is limited to the same task branch. Force, force-with-lease, mirror, all-branch, and default-branch pushes are forbidden.
9. The remote task-branch SHA must equal local `REVIEW_REF` before the task becomes `EXECUTED`.
10. Durable task metadata is versioned, schema-validated, and project-scoped.
11. Browser Bridge remains the Control Plane only; GitHub is the GITHUB-mode code/data plane.
12. Browser Bridge never carries source, diffs, or repository archives for GitHub review.
13. M3 must consume the frozen `CodeProvider` and `BrowserAutomationSession` boundaries instead of bypassing them.

Post-freeze M2 changes are limited to security defects, confirmed Git compatibility defects, confirmed GitHub transport compatibility defects, persistence/recovery defects, and regressions against this contract. M3 convenience is not a reason to reshape M2.

## Real GitHub dogfood acceptance

The M2 workflow was exercised against `Jickfu/codex-duet` with task `m2-dogfood-20260902` and task branch `agent/task-m2-dogfood-20260902`.

- Acceptance range: `f4b1dd012f79b8a6522f56d40d46f7af39a14923..fdb97758eb0e4c9e470b27f700eb1ea6f1ea3c92`
- `BASE_REF`: `f4b1dd012f79b8a6522f56d40d46f7af39a14923`
- `REVIEW_REF`: `fdb97758eb0e4c9e470b27f700eb1ea6f1ea3c92`
- Test status: `PASS` — 109 tests passed.
- Local `HEAD`, durable `REVIEW_REF`, and remote task-branch SHA were identical.
- GitHub comparison confirmed one commit ahead, merge base equal to `BASE_REF`, and exactly one changed file: `docs/acceptance/M2-github-mode-dogfood.md`.
- The acceptance commit was documentation-only and is evidence, not the implementation baseline.
- ChatGPT reviewed exactly the immutable range through the GitHub Data Plane and returned `PASS` with no findings.

The dogfood branch is intentionally not merged or deleted as part of the freeze.

## Boundaries

- GitHub is the code/data plane: commits, files, diffs, documentation, and tests are reviewed there.
- Browser Bridge is only the control plane. It carries a compact C2C envelope and never carries source, diffs, repository archives, DOM state, browser storage, or credentials.
- M1 Browser Bridge remains frozen. GitHub Mode depends on the existing `BrowserAutomationSession` boundary and does not bypass or redesign it.
- `CodeProvider` is the mode-aware data-plane boundary, using LOCAL/GITHUB discriminated context and review-target unions. M2 supplies `GitHubCodeProvider`; a Local provider implementation is deferred to M4.

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

## Local Git and GitHub Platform

`GitHubCodeProvider` means the GitHub-mode code-context provider; it is not a GitHub Platform API adapter. Its correctness-critical repository and transport operations continue to use the deterministic `GitRunner`/system Git CLI, including status, local HEAD, branch creation, ancestry, push, and remote SHA verification.

PRs, checks, workflows, comments, and platform metadata form a separate future `GitHubPlatform` capability boundary. A structured Codex GitHub plugin/skill, `gh`, or REST adapter may support that boundary later. M2 binds none of them. Natural-language agent output must never be parsed as a correctness-critical infrastructure primitive.

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
