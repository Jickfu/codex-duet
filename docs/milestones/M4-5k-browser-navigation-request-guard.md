# M4.5k Browser navigation request guard

Status: implementation and self-review on 2026-09-04; M4 remains unfrozen.

Base: `60ff6a91c4c4683565bbfbd79a376704956208ef`.

The intermittent navigation error classification recorded in M4.5i depended on a 25 ms delay after an execution-context-destroyed exception. Document commit could arrive later, leaving the operation with a raw Playwright error rather than `ORIGIN_DENIED`.

The operation guard now also observes main-frame navigation requests. An outside-origin request latches denial for that operation before document commit, including when navigation is eventually aborted. Existing committed-navigation and current-URL checks remain. This does not intercept network traffic, retry operations, authorize another origin, or modify frozen protocol/checkpoint schemas. Foreign subresources and subframe navigations do not invalidate the main-frame operation. Both event listeners are removed when the operation ends.

Regression coverage holds an outside-origin navigation response until the guarded operation has rejected, so error classification cannot depend on a commit-delay grace period. Separate coverage checks foreign iframe/resource loading and listener cleanup. Existing document-bound composer and foreign-DOM untouched assertions remain unchanged.

Verification: full serial regression passed all 46 files, with 470 tests passed and one existing Windows/POSIX-specific skip. All 34 Browser fixture tests passed. Typecheck, lint, build, touched-file formatting and whitespace checks passed.

This is a local browser-fixture verification, not a live ChatGPT acceptance. Playwright LOCAL exact-send proof and final M4 acceptance remain pending.
