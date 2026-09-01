# M2 GitHub Mode Dogfood Acceptance

This file exists only to provide a real immutable GitHub review target for the M2 acceptance gate.

Acceptance path:

1. Initialize one task branch through `chatbridge github init-task`.
2. Commit this documentation-only change.
3. Prepare the review through `chatbridge github prepare-review`.
4. Verify the pushed task-branch SHA equals the local immutable `REVIEW_REF`.
5. Review exactly `BASE_REF..REVIEW_REF` through the GitHub data plane.

No M2 implementation code is changed by this acceptance commit.
