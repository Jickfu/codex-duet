# Codex Duet

[English](README.md) | [简体中文](README.zh-CN.md)

**ChatGPT plans and reviews. Codex implements.** A guarded development workflow with durable task state and immutable review evidence.

## Install into your project with Codex

Open your target project in Codex and send:

```text
帮我安装这个 skill 到本项目下：https://github.com/Jickfu/codex-duet
请阅读仓库的 INSTALL.md，完成项目内安装并验证 doctor。
```

Codex should execute [INSTALL.md](INSTALL.md): download the complete bundle, install it into **`<your-project>/.agents/skills/codex-duet/`**, install dependencies and verify `doctor`. Copying `SKILL.md` alone is insufficient. An existing installation is preserved rather than overwritten.

Requires **Node.js 20+, npm, Git and network access**. No pnpm, source compilation or global installation is needed. The runtime comes from the included tarball; its dependencies are downloaded from the npm registry. This project is not published to npm.

> AI assistants: an installation request means execute [the installation procedure](INSTALL.md). Do not start the Planner/Reviewer workflow or modify the user's application as part of installation.

## Manual installation

[Download the standalone skill ZIP](https://raw.githubusercontent.com/Jickfu/codex-duet/main/skill/codex-duet.zip), extract it to a temporary directory, and replace both paths below with absolute paths:

```text
npm --prefix "<extracted-codex-duet-directory>" run install:project -- --project "<your-project>"
```

The installer copies the complete skill, installs dependencies and verifies readiness. It stops if the destination exists. [Browse the bundle](skill/codex-duet).

## Use the installed skill

Ask Codex to use **codex-duet** to plan, implement and review a task. Codex discovers repository skills under `.agents/skills`; if it is not visible, restart Codex or ask it to read `.agents/skills/codex-duet/SKILL.md`. See [OpenAI's skill documentation](https://learn.chatgpt.com/docs/build-skills).

Run commands from your target project's root:

```text
node .agents/skills/codex-duet/scripts/chatbridge.mjs doctor
node .agents/skills/codex-duet/scripts/chatbridge.mjs --help
```

`doctor` checks installation prerequisites. A GITHUB task also needs GitHub access, Planner/Reviewer contracts in its baseline and the chosen browser connection. Installation does not create contracts, commit or push, or send ChatGPT messages. Installed skill files are project additions; decide how to version them before starting a workflow that requires a clean worktree.

## Supported workflows

| Mode   | How ChatGPT reads code                      | Scope                                                                           |
| ------ | ------------------------------------------- | ------------------------------------------------------------------------------- |
| GITHUB | Immutable GitHub commit ranges              | Included skill recipe: planning, execution and multi-round review               |
| LOCAL  | Immutable read-only Git workspace snapshots | Runtime commands and guides; remote access accepted for single-user development |

Codex remains the sole executor. Each task selects one browser provider. Uncertain sends are not automatically replayed. Login is manual. Keep the project's `.chatbridge` directory: it contains task state and recovery evidence.

The bundled skill recipe covers GITHUB mode. LOCAL usage is documented separately; installation does not configure a tunnel, OAuth grant or MCP connection. Automated PR creation and production remote deployment are not included.

## Documentation

- [Project installation](INSTALL.md) and [installation/recovery](docs/installation-and-recovery.md)
- [GITHUB](docs/github-mode.md), [LOCAL](docs/local-mode.md) and [remote LOCAL setup](docs/remote-local-mode.md)
- [Browser connection](docs/browser-bridge.md), [protocol](docs/protocol.md) and [security](docs/security.md)
- [Architecture and milestone status](docs/architecture.md)
- [Distribution maintenance](docs/skill-distribution.md) and [validation evidence](docs/milestones/M6-skill-distribution.md)

## Development

Source builds use Node >=22.13 and pnpm 11.17.0:

```text
pnpm install --frozen-lockfile
pnpm build
npm run typecheck
npm run lint
```

Follow the [maintainer workflow](docs/skill-distribution.md) to update distribution artifacts. CI runs full regression on Windows/Linux/macOS, then package and skill installation checks on Node 20/22/24. Browser tests use fixtures, without a ChatGPT account; live acceptance has a separately documented scope.

[Apache-2.0 license](LICENSE).
