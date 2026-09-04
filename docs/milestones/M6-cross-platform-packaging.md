# M6.2 — Cross-platform package verification

Status: workflow implemented; remote results pending. M6 remains open.

The matrix covers Windows, Linux and macOS with Node 20, 22 and 24. Every cell checks types/lint and executes the M6.1 clean-build, manifest-audit and outside-checkout installation smoke. It verifies installed CLI version/help, command shim and offline doctor without opening a browser, starting a tunnel or granting OAuth access. This is package compatibility coverage, not live Browser acceptance on those platforms.

Build dependencies are installed from the committed pnpm lock using Node 24 and pnpm 11.17.0, before selecting the runtime under test. pnpm 11 requires Node >=22.13; that build-tool requirement is separate from the packaged CLI's Node >=20 runtime contract. See [pnpm's release documentation](https://github.com/pnpm/pnpm.io/blob/main/blog/releases/11.0.md). Actual runtime compatibility depends on the matrix outcome.

Actions are pinned to verified commit SHAs. Workflow permissions are read-only, checkout does not persist credentials, and no publication secret is used. Successful jobs upload only the audited tarball and its result record, retained for 14 days and named by OS, runtime and source SHA. No whole `.chatbridge` directory or installation tree is uploaded. Artifact handling follows [the action's documented controls](https://github.com/actions/upload-artifact).

## Distribution policy for this increment

Use successful workflow artifacts as reviewable development candidates. The result's integrity value identifies the tested tarball; the job's source SHA identifies its code. Different platform/runtime candidates are not assumed byte-identical. Dependency installation for a consumer resolves the declared runtime dependency ranges; this is not a vendored/offline bundle.

There is no automatic npm publish, GitHub Release, version bump or production deployment. Registry namespace/ownership, release credentials, version/channel policy and production distribution remain a separate user decision. Existing task evidence and frozen protocol boundaries are unchanged.
