# Installation checks and recovery

M6.1 provides source packaging and offline prerequisite checks. This is not an npm registry release or an automatic updater.

## Build and verify a package

From a source checkout with development dependencies installed:

```text
pnpm install --frozen-lockfile
npm run verify:package
```

Use npm for `verify:package`; the script invokes that npm CLI directly, without shell argument construction. It runs the prepack clean build, audits the package manifest, installs the resulting tarball in an isolated directory and exercises the installed CLI's version, help and offline doctor commands. Dependency installation can use the network. Installation scripts and browser downloads are disabled, nothing is installed globally and nothing is published.

Evidence and the tarball remain in `.chatbridge/package-check-*/`. The result records package integrity and the tested Node/platform. The tarball contains built code, package metadata, license and documentation; source-checkout scripts, repository metadata, live task evidence, credentials and local tools are excluded. `npm pack` also runs the clean build automatically. `--ignore-scripts` bypasses that build and must not be used to produce a release candidate.

The clean build replaces only this checkout's disposable `dist` directory and refuses a redirected/symlink output root. Do not put hand-maintained files in `dist`. Consumers install the tarball; development/build commands in package metadata require the source checkout and its development dependencies.

## Check before starting a task

```text
chatbridge doctor
```

This offline command checks Node >=20, Git on PATH and required installed artifacts. It prints JSON and exits nonzero when a prerequisite fails. It does not start a browser/tunnel, contact ChatGPT, initialize `.chatbridge`, approve OAuth, or validate a task. A PASS is installation readiness, not login or remote connectivity readiness. The current installed-package smoke records its actual runtime; the minimum supported Node version is not a claim of full platform-matrix validation.

For browser attachment diagnostics, use `chatbridge browser doctor` separately. That existing command performs attach/channel probes and may need browser authorization; it is not the offline check. For remote LOCAL setup, follow [remote development mode](remote-local-mode.md), including explicit cloudflared selection and approval of the exact local OAuth request.

## Recover without losing evidence

| Observation                                                | Next action                                                                                                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Offline doctor reports missing artifacts                   | Rebuild from source or reinstall a verified tarball. Keep the task's `.chatbridge` directory.                                                                                               |
| Browser send is ATTEMPTED or OUTCOME_UNKNOWN               | Inspect the existing conversation and durable operation; do not resend or recreate the task. Use the selected provider's documented reconciliation boundary.                                |
| A received reply fails syntax validation                   | Preserve its raw artifact. Use [bounded format repair](adr/ADR-027-local-format-repair.md) only when eligible; never edit the stored reply.                                                 |
| A replacement app is unavailable in the bound conversation | Only an explicitly authorized, exact unsent Reviewer can use [controlled handoff](adr/ADR-028-local-reviewer-conversation-handoff.md). An interrupted handoff requires identical arguments. |
| Remote service or token lifetime ends                      | Start a new service lifetime and explicitly reconnect/authorize. Existing task and snapshots remain; restarting cannot replay Browser messages.                                             |
| Worktree differs from recorded execution/review            | Inspect `local run-status --task <id>` and the documented execution reconciliation flow. Do not reset the worktree or publish unrelated files as accepted evidence.                         |

Do not delete `.chatbridge` to solve a transport, syntax or installation problem: it holds the task authority and recovery evidence. These instructions do not grant approval for a new send, migration or authorization.
