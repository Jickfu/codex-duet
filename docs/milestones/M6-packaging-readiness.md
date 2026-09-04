# M6.1 — Packaging and installation readiness

Status: **M6.1 IMPLEMENTED / LOCAL VALIDATION PASSED**, 2026-09-04. Baseline: M5 freeze `3b6b15e5a2f01d5e59d8a5545bf3446d7ee87e6f`. M6 as a whole is not frozen.

The user approved pushing M5 and continuing M6 with installation, startup checks, recovery and documentation as priorities. M5 was pushed and the remote main ref was verified at the baseline above.

This increment adds a clean prepack build, allowlisted package-content audit, isolated tarball installation with installed-CLI checks, and `chatbridge doctor` for offline prerequisites. The [installation/recovery guide](../installation-and-recovery.md) distinguishes installation readiness from browser/session/task readiness and points to the existing evidence-preserving recovery paths.

No protocol, task authority, OAuth grant, Browser send rule or snapshot contract changes are included. No global install, registry publication, remote service startup, automatic recovery or task replay is part of validation. M6 as a whole remains open: broader runtime/platform coverage, distribution/release policy and further hardening require subsequent increments.

## Validation

Typecheck, lint, build and the full serial regression passed: **56 files, 551 tests passed, one platform skip (552 total)**. Source stayed unchanged during that run. Documentation formatting and whitespace checks passed separately.

The final installed-package smoke ran on Windows with Node `v24.18.0`. It verified 395 allowlisted package files, an isolated installation outside the source checkout, the installed command shim, version/help surfaces and offline doctor. A disposable stale JavaScript output was deliberately added before prepack; the clean build removed it and the audited tarball excluded it. Production dependencies installed with lifecycle scripts disabled; no browser was downloaded or launched.

Local smoke evidence: `.chatbridge/package-check-LrIIft/result.json` and its tarball. Package integrity: `sha512-VlJQ/A1TpwBtd7QBkgKu8u+MQm3Ri8MFtn61L2iyqf66t+Blzhl7lANpEhwTuUUJUZuwdOD8FQKd9r1S3J/8KA==`. This identifies the tested candidate before the final validation-summary documentation update, not an npm registry release. The temporary installation location is retained in the result for inspection. Other Node/platform combinations remain unverified by this smoke.
