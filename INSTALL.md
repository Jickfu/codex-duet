# Project-local skill installation / 项目内安装

This is an executable installation procedure for Codex and other coding assistants. When the user says “帮我安装这个 skill 到本项目下” and identifies this repository, carry out these steps within that authorization. Do not stop after describing commands. Respect the host's actual tool, network and approval restrictions; report a real blocker rather than claiming completion.

## 1. Identify the destination

Capture the absolute root of the **user's currently open target project before downloading or changing directories**. If no project can be identified, ask for the target directory. The destination is `<project>/.agents/skills/codex-duet/`, not the global skill directory and not the downloaded repository.

Check Node >=20, npm and Git. Missing system tools are a separate setup action. If the destination exists, preserve it and report the existing installation; do not delete, merge or overwrite it. The installer enforces this check and rejects symlinked skill parents.

## 2. Download the complete bundle

Download [skill/codex-duet.zip](https://raw.githubusercontent.com/Jickfu/codex-duet/main/skill/codex-duet.zip) into a new temporary directory and extract it there using the host's supported tools. Read the extracted `codex-duet/INSTALL.md` and `package.json` before executing it. The ZIP contains its own scripts and tarball; do not mix files from different revisions.

If ZIP download is unavailable but Git works, use a temporary sparse checkout of `https://github.com/Jickfu/codex-duet` containing `skill/codex-duet`, then use that complete directory. Keep downloads outside the target project. Do not initialize or replace the target project's Git repository.

## 3. Execute the project installer

Replace both placeholders with the captured absolute paths. Use structured process arguments where available and quote shell paths:

```text
npm --prefix "<absolute-extracted-codex-duet-directory>" run install:project -- --project "<absolute-target-project>"
```

This copies only distribution files into `.agents/skills/codex-duet/`, verifies the runtime archive's SHA-512, installs dependencies with lifecycle scripts and browser downloads disabled, and runs offline doctor from the target project. Final output must contain `status: INSTALLED` and `doctor: PASS`.

If setup fails after copying, the new directory is retained for inspection. Report the error and partial state. Once the cause is resolved, resume with `npm --prefix "<installed-skill-directory>" run setup`, then doctor. Do not remove files or expect the project installer to overwrite them.

## 4. Verify and report

Check `<project>/.agents/skills/codex-duet/SKILL.md` exists. From the target project run:

```text
node .agents/skills/codex-duet/scripts/chatbridge.mjs doctor
```

Report the absolute installed path and actual doctor result. Tell the user to invoke codex-duet for their development task; if not listed yet, restart Codex or read that `SKILL.md` explicitly. Repository discovery uses `.agents/skills`, as documented by [OpenAI](https://learn.chatgpt.com/docs/build-skills).

Installation must not create a development task, edit contracts, commit or push, attach a browser, grant OAuth, or change global Codex configuration. Preserve the project's `.chatbridge` directory. The installed `.gitignore` excludes dependencies; skill files remain project additions whose version-control handling should be decided before a clean-worktree GITHUB task.
