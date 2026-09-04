# M6.3 — Cross-platform regression gate

Status: **M6.3 REMOTE REGRESSION AND PACKAGE GATES PASSED**, 2026-09-04. M6 remains open.

This increment extends package readiness with the complete existing regression suite on Windows, Linux and macOS, using Node 24. Each platform builds from the committed lockfile and runs tests serially. All three regression jobs must succeed before the nine Node 20/22/24 package jobs can start.

The browser adapter tests use an explicitly installed Chromium and intercepted fixture pages. They do not establish a live ChatGPT session or repeat M5 remote acceptance. Other integration tests exercise temporary Git repositories, local listeners and bounded fixture processes. Platform skips remain visible in JUnit reports; this is not a claim that every test executes on every platform.

The workflow preserves only the JUnit XML report from regression jobs, including failed test runs when the report exists. Package jobs continue to upload only their verified tarball and result record. Both artifact kinds identify the source SHA and expire after 14 days. No task directory, browser profile, token or publication credential is uploaded.

Production dependency audit on 2026-09-04 (`pnpm audit --prod --json`) reported zero known advisories across 101 dependencies, including three optional dependencies. This is a point-in-time report for the checkout lockfile, not a guarantee about future consumer dependency resolution or undisclosed vulnerabilities.

## Remote validation

All three regression jobs passed for workflow/source ref `92d22ec19533f58d4714126d784fbebb5baf2d44`, [Actions run 33840655870](https://github.com/Jickfu/codex-duet/actions/runs/33840655870).

Downloaded JUnit reports in `.chatbridge/m6-ci-33840655870` independently confirm 552 passed on Linux, 552 passed on macOS, and 551 passed with one platform skip on Windows. All reports contain zero failures and zero errors. All nine downstream package jobs also passed. Their downloaded tarballs were independently checked against the recorded SHA-512 integrity, runtime/platform and source SHA. Thus all 12 jobs passed for the exact ref above.

The closeout changes only documentation and skips duplicate CI; it does not claim validation of changed application or workflow bytes.

Registry publication, release version/channel and production distribution remain undecided. This increment does not publish a release or change runtime/task contracts.
