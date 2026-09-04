# M6.4 — Downloadable repository skill

Status: **DIRECTORY DISTRIBUTION VALIDATED**, 2026-09-04.

The user selected a repository-contained skill folder with compiled artifacts, without npm publication. The deliverables are `skill/codex-duet/` and a standalone `skill/codex-duet.zip`. See [installation and maintenance](../skill-distribution.md).

The runtime tarball was built and smoke-tested from committed inputs at `9f551095c3314d59b5c28ae985f18e8c2fd5ee38`; `bundle.json` records `sourceDirty: false`. Its SHA-512 is `sha512-Y4Jt7TC2QNCJfQdb+UnUaa48nu6+q3tSazPMAmvBSwI7D0VkvnaH6e6MfGWjX031rmb0iPY1Pp5dhnWpQ0fijQ==`. The ZIP contains exactly the nine files of the committed skill tree at `b02978a3e1937efde950a43dc9507afb9460ca26`, verified by entry names and extracted bytes against Git objects. ZIP SHA-256: `92de18fe324d678d27e395190b87ad8f8d94017be7e1d05ec1e428f2faf8ab33`.

The skill validator, typecheck, lint and local installation smoke passed. The latter uses an outside-checkout path containing spaces, rejects a missing runtime and a deliberately corrupted archive, checks version/help/doctor and initializes only a disposable target Git repository. It confirms that target state is not written into the skill installation.

## Hosted validation

The initial run `33844005467` exposed physical CRLF/LF differences in TypeScript's emitted multiline script literals. The source-freshness comparison now normalizes only physical CRLF; the tarball SHA-512 check remains exact. Source file membership, escaped characters and all other emitted content still participate in freshness checks. The archive and runtime did not need modification.

All 12 jobs passed for `fb7028bf2ac7ec62d19766d4b962ed8e72d1fef7`, [run 33844800089](https://github.com/Jickfu/codex-duet/actions/runs/33844800089).

Downloaded JUnit reports confirm 552 passed on Linux, 552 passed on macOS, and 551 passed with one platform skip on Windows. All nine package jobs also passed the downloaded-skill verification step on Node 20/22/24. The final closeout adds the byte-verified ZIP and documentation only, and skips duplicate CI; application, installer and workflow bytes are unchanged from the tested ref.

No npm publication, global installation, GitHub Release or live Browser send was performed. The downloaded skill retains the GITHUB recipe and ships LOCAL runtime documentation; it does not claim a new LOCAL skill acceptance or production remote service readiness.
