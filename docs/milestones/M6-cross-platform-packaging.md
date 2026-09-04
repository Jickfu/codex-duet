# M6.2 — Cross-platform package verification

Status: **M6.2 REMOTE MATRIX PASSED**, 2026-09-04. M6 remains open.

The matrix covers Windows, Linux and macOS with Node 20, 22 and 24. Every cell checks types/lint and executes the M6.1 clean-build, manifest-audit and outside-checkout installation smoke. It verifies installed CLI version/help, command shim and offline doctor without opening a browser, starting a tunnel or granting OAuth access. This is package compatibility coverage, not live Browser acceptance on those platforms.

Build dependencies are installed from the committed pnpm lock using Node 24 and pnpm 11.17.0, before selecting the runtime under test. pnpm 11 requires Node >=22.13; that build-tool requirement is separate from the packaged CLI's Node >=20 runtime contract. See [pnpm's release documentation](https://github.com/pnpm/pnpm.io/blob/main/blog/releases/11.0.md). Actual runtime compatibility depends on the matrix outcome.

Actions are pinned to verified commit SHAs. Workflow permissions are read-only, checkout does not persist credentials, and no publication secret is used. Successful jobs upload only the audited tarball and its result record, retained for 14 days and named by OS, runtime and source SHA. No whole `.chatbridge` directory or installation tree is uploaded. Artifact handling follows [the action's documented controls](https://github.com/actions/upload-artifact).

## Distribution policy for this increment

Use successful workflow artifacts as reviewable development candidates. The result's integrity value identifies the tested tarball; the job's source SHA identifies its code. Different platform/runtime candidates are not assumed byte-identical. Dependency installation for a consumer resolves the declared runtime dependency ranges; this is not a vendored/offline bundle.

There is no automatic npm publish, GitHub Release, version bump or production deployment. Registry namespace/ownership, release credentials, version/channel policy and production distribution remain a separate user decision. Existing task evidence and frozen protocol boundaries are unchanged.

## Verified remote evidence

[Actions run 33839979371](https://github.com/Jickfu/codex-duet/actions/runs/33839979371) completed successfully for source/workflow ref `02920397ba2e13af5ed563a52a5cf13f30c7322a`: all nine jobs passed. The earlier run `33839859332` was superseded after GitHub warned that the initially selected Actions used deprecated Node 20 action runtimes; the final workflow uses pinned native Node 24 Actions, independently of the application runtime under test.

| Platform | Node 20      | Node 22      | Node 24      |
| -------- | ------------ | ------------ | ------------ |
| Linux    | 20.20.2 PASS | 22.23.2 PASS | 24.19.0 PASS |
| Windows  | 20.20.2 PASS | 22.23.2 PASS | 24.19.0 PASS |
| macOS    | 20.20.2 PASS | 22.23.1 PASS | 24.18.0 PASS |

All nine uploaded result records and tarballs were downloaded into gitignored `.chatbridge/m6-ci-33839979371`. Each reported runtime/platform matched its matrix cell, each installed CLI reported PASS, and each downloaded tarball's recomputed SHA-512 matched the result's integrity value. These are actual hosted-runner package results, not locally simulated platform claims.

Only documentation closes out this verified ref. The closeout commit skips duplicate CI because application and workflow bytes remain unchanged; it does not claim a second validation of different source. M6.1's full local regression (551 passed, one platform skip) remains the application regression evidence. This matrix adds packaging checks, not a nine-platform full Browser test suite.
