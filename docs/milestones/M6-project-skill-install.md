# M6.5 — Project-local installation and bilingual entrypoints

Status: **PROJECT INSTALLATION VALIDATED**, 2026-09-04.

The user requested an improved README, a Chinese version, and an executable response to “帮我安装这个 skill 到本项目下”. `README.md` and `README.zh-CN.md` now route that request to the root `INSTALL.md` procedure. The bundled `install:project` command installs into the explicitly named project's `.agents/skills/codex-duet/` and verifies offline doctor.

The installer requires an absolute existing project directory. It refuses an existing destination and redirected skill parents, copies only the ten distribution files, runs setup with lifecycle scripts disabled, and reports success only after doctor passes. A partial installation remains available for inspection after failure; no project files are deleted. Installing does not initialize a development task, modify contracts, commit, push, connect a browser or change global Codex settings.

Local smoke exercised the README's exact `npm --prefix ... run install:project -- --project ...` command with paths containing spaces. It verified project installation, doctor, preservation of an existing task marker and unrelated skill, unchanged Git HEAD and fixture content, repeated-install refusal, and rejection of a redirected `.agents` parent. Canonical skill validation, typecheck, lint and README local-link checks passed.

A separate real-download smoke fetched the ZIP from the pinned GitHub ref below, verified its SHA-256, extracted it and installed into a temporary project named `用户项目 demo`. The actual project installer reported INSTALLED/PASS; the existing file was preserved and neither `.git` nor `.chatbridge` was created. Local evidence: `.chatbridge/project-install-download-result.json`.

Runtime inputs were committed at `aea9735`; the bundle records clean inputs and integrity `sha512-W6tL7JWBMZNX9U1/zLrB8MpSopbMdBvD47VlBCxCQyTK6XcVlHxmv5g3peqUTZAamZnAcBPsXMG5FAoTngpiuA==`. The ZIP's ten entries were checked against the committed skill tree at `2732fee`; SHA-256 is `61ce5594980c5252e92592632f35cf6b891ec627330bc4074686b4f498092285`.

## Hosted validation

All 12 jobs passed for `baa999bddf83816c576964819a6333f5b34128e8`, [Actions run 33846573060](https://github.com/Jickfu/codex-duet/actions/runs/33846573060).

All nine skill-installation steps passed on Windows/Linux/macOS with Node 20/22/24. Downloaded JUnit reports confirm 552 passed on Linux, 552 passed on macOS, and 551 passed with one platform skip on Windows, with zero failures/errors. The closeout changes documentation only and skips duplicate CI; application, installer, workflow and archive bytes remain those of the tested ref.

These checks prove the installation commands and bundle work in the tested environments. They do not guarantee that every user's Codex host has network/shell permissions or available prerequisites; the runbook tells the assistant to report real blockers and partial state. No external model or live ChatGPT workflow was invoked to test installation.
