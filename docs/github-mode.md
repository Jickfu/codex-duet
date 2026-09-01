# GITHUB mode

Status: **IMPLEMENTED / FROZEN M2**

Frozen implementation baseline: `f4b1dd012f79b8a6522f56d40d46f7af39a14923`

GITHUB mode uses the shared Browser Control Plane for compact C2C messages and GitHub as the code Data Plane. It does not use Local MCP, a workspace MCP server, cloudflared, or a local tunnel.

## Architecture

```mermaid
flowchart TB
    subgraph CP[CONTROL PLANE]
        C[Codex Desktop] -->|compact C2C| B[Browser Bridge]
        B --> W[ChatGPT Web]
    end
    subgraph DP[DATA PLANE]
        W -->|read repository and immutable review range| G[GitHub]
    end
```

## Task and review sequence

```mermaid
sequenceDiagram
    participant U as User
    participant C as Codex / Skill
    participant B as Browser Bridge
    participant W as ChatGPT Web
    participant G as GitHub
    U->>C: Request
    C->>C: M3 duet init composes M2; create agent/task-taskId
    C->>B: PLANNING (BASE_REF)
    B->>W: compact C2C
    W->>G: Read repository at BASE_REF
    W-->>C: PLAN through deterministic browser wait
    C->>C: Edit, test, commit
    C->>G: M3 duet prepare-review composes M2; push task branch
    C->>G: Verify remote SHA
    C->>B: EXECUTED (BASE_REF, REVIEW_REF)
    B->>W: compact C2C
    W->>G: Review BASE_REF..REVIEW_REF
    W-->>C: PLAN, DONE, or BLOCKED
```

Because GitHub is the Data Plane, ChatGPT cannot review an uncommitted working tree in this mode. Codex must commit and push before formal review.

## Git responsibilities and safety

Correctness-critical operations use `GitRunner` and the system Git CLI:

- status, current branch, and `HEAD`
- commit ancestry
- task-branch creation
- push
- `ls-remote` verification

One task owns exactly one generated branch:

```text
agent/task-<taskId>
```

Formal review identity is exactly:

```text
BASE_REF..REVIEW_REF
```

Both values are immutable full 40-character commit SHAs. Branches, tags, `HEAD`, remote-tracking names, short SHAs, and other moving refs are forbidden as formal review identities. After push, the remote task-branch SHA must equal the local `REVIEW_REF`.

The Frozen M2 implementation supplies task/ref safety, verified push, persistence, CLI commands, and compact review-envelope primitives. See [the M2 milestone](milestones/M2-github-mode.md) and [ADR-008](adr/ADR-008-immutable-github-review-range.md).

## M3.2b crash-reconciliation boundary

M3.2b is implemented with real Desktop crash E2E still required. It inspects local branch, full `HEAD`, ancestry, worktree/conflict metadata, iteration execution evidence, and existing Frozen M2 status. It does not duplicate or replay M2 push, remote-SHA verification, review-ref creation, or branch-safety logic.

If Frozen M2 conclusively finished the current iteration before M3 persisted `EXECUTED`, reconciliation may adopt the durable `GitHubReviewTarget` and reconstruct the deterministic review envelope without repushing. Adoption requires matching repository and task branch, clean conflict-free worktree, `HEAD == M2.reviewRef`, execution-base ancestry, test status, and multi-round review monotonicity. A stale prior-iteration review ref or a local `HEAD` advanced beyond M2 evidence is not adoptable and fails closed. See [ADR-014](adr/ADR-014-executing-crash-reconciliation.md).
