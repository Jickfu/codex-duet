# M4.5b LOCAL data-plane CLI checkpoint

Status: implemented and self-reviewed on 2026-09-03; M4 is not frozen.

Base: `e0d997996040499a404d67f1cf5bf77c053a6ce5`.

The additive `local` command group exposes init-task, status, assert-ready, capture, record-evidence and prepare-review. It reuses the existing snapshot, evidence and provider authorities under task-scoped locking. No GITHUB schema or lifecycle implementation is changed.

Self-review checked task/evidence identity, sequential iterations, missing-context rejection, pre-existing dirty baselines, immutable replay and post-test drift. A prepared review cannot acquire evidence for a replacement snapshot. Recovery returns the original target even if live files change; a separate readiness check rejects that drift. Input evidence is a caller assertion, not proof of test execution.

## Verification

- Real Git CLI integration: two rounds, process-independent command reconstruction, repeated evidence/target operations, later live edits, no remote and unchanged HEAD/refs/index.
- Failure coverage: missing context, foreign task evidence, skipped iteration, nonnumeric iteration, post-candidate drift and attempted replacement of a prepared snapshot.
- `pnpm test --maxWorkers=1`: 41 files passed; 412 tests passed, 1 Windows/POSIX-specific skip.
- Typecheck, lint, build, changed-file Prettier and diff whitespace checks passed.
- Built CLI help verified for the new command group and prepare-review command.

## Remaining work

This is a data-plane command integration checkpoint, not complete LOCAL orchestration or real Browser acceptance. TaskSpec/control identity, selected Browser provider, optional Discussion, full PLAN/execution/review lifecycle and crash/resume acceptance remain pending. No external ChatGPT review approval is claimed. No main integration or M5/public exposure is included.
