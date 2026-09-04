# Repository skill distribution

The user selected repository-folder distribution instead of npm publication or a GitHub Release. The deliverable is `skill/codex-duet`, containing the skill entrypoint, workflow, installation instructions, launcher and a verified runtime tarball. Download the repository ZIP and keep that entire folder. The runtime needs Node 20+, npm and Git; consumer setup does not require pnpm or compilation.

`npm run setup` in the skill folder checks the tarball's SHA-512 against `bundle.json`, then installs its local-file dependency with lifecycle scripts disabled. Transitive runtime dependencies still come from the configured registry. The launcher resolves only its adjacent runtime and preserves the caller's working directory, arguments, signals and CLI exit status. Use a fresh folder for upgrades; preserve all target-project task evidence.

The bundled skill preserves the existing GITHUB orchestration recipe. LOCAL runtime commands and guides are shipped in the tarball, but installation does not set up OAuth, a tunnel or a Browser session. Missing target-project contracts require a separate reviewed setup change before task initialization.

## Maintainer workflow

The canonical skill text is `.agents/skills/codex-duet/`. Edit it there. Installer and launcher sources live directly in `skill/codex-duet/scripts/`. After committing source changes:

```text
npm run build:skill
npm run verify:skill
```

`build:skill` first performs the clean package build, manifest audit and isolated package smoke from M6.1. Only after that succeeds does it copy the verified tarball and canonical skill text into the distribution folder. `bundle.json` records the package version, integrity and source commit, plus whether runtime/package/documentation inputs were dirty. Commit the resulting bundle separately and push the complete pair of commits. No publish command is involved.

`verify:skill` builds the current checkout and tests an allowlisted copy of the checked-in skill outside the repository, using paths containing spaces. It verifies rejection of missing runtime and corrupted archive, normal setup, version/help/doctor, and task initialization in a disposable Git target rather than the installation folder. It also compares every current compiled file against the installed bundled runtime, so a stale tarball cannot pass merely because its version number stayed the same. Canonical and distributed skill text must match, allowing only checkout line-ending normalization.

The package CI matrix runs this verification on all nine platform/runtime combinations after the three-platform full regression gate. A failure blocks package readiness. Downloaded dependencies and disposable task fixtures are not committed or uploaded.
