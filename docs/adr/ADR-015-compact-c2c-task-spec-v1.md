# ADR-015: Compact C2C and TaskSpecV1

## Status

Accepted / Frozen.

## Context

The Browser Bridge is the shared Control Plane, while GitHub and future read-only LOCAL MCP are repository Data Planes. Real Desktop evidence showed short sends were reliable but an approximately 24K-character composer payload produced an ambiguous outcome and temporarily unresponsive UI. Repeating the raw user request and stable Planner/Reviewer policy in Browser messages had turned the Control Plane into task-context transport.

M3 already persists the plaintext raw request locally at `.chatbridge/runs/<taskId>/request.md` and keeps its SHA-256 in `DuetRunCheckpointV2`. It lacked a normalized durable semantic authority and compact role-specific projections.

## Decision

Codex Desktop remains the sole Executor and owns request normalization. For every new compact task it supplies a strict `TaskSpecV1` to deterministic `duet init`; chatbridge validates and persists the candidate but never invents or summarizes intent.

The local, gitignored `.chatbridge/runs/<taskId>/task-spec.json` is the semantic authority. It is immutable after successful initialization, uses deterministic canonical JSON semantics and SHA-256 integrity, and is separate from the unchanged `DuetRunCheckpointV2`. Atomic create-or-verify makes byte-identical torn-init replay idempotent while rejecting divergent content with `TASK_SPEC_IMMUTABLE`. The raw request remains local plaintext evidence and is never automatically committed, pushed, or logged. Phase 1 has no amendment engine; a material correction requires an explicit future amendment workflow and must not mutate the initial specification silently.

Compact-task identity is independently pinned in `.chatbridge/runs/<taskId>/task-context.json`. Strict `TaskContextV1` records only task ID, TaskSpec SHA-256, and the first Planner control SHA-256. It is atomically create-or-verify and immutable. Init inspects TaskSpec, TaskContext, and the first Planner control before selecting Compact or legacy semantics. Any existing Compact evidence forces Compact recovery even when a retry omits `--task-spec-file`; a persisted TaskSpec is revalidated against the raw request and durable GitHub context, then deterministically regenerates the Planner projection. TaskContext or Planner evidence without TaskSpec fails `TASK_SPEC_MISSING`. Existing Planner bytes are create-or-verify evidence and are never overwritten by a different projection. Only absence of all three Compact artifacts selects genuine legacy initialization.

Before normal M2 review preparation, orchestration verifies the marker, TaskSpec integrity and pinned fingerprint, and the byte-exact persisted Planner control fingerprint. A marker with a missing or divergent TaskSpec fails closed before `getReviewTarget`; Crash-B adoption performs the same read-only semantic preflight and never repushes.

PlannerControlV1 and ReviewerControlV1 are internal projections serialized as existing C2C/1 envelopes. The first Planner projection carries task identity, the Planner contract path, and every task-specific semantic field: objective, allowed and forbidden scope, MUST and SHOULD acceptance criteria, exact literals, protocol requirements, Planner notes, and review criteria. The Reviewer projection carries immutable review identity and the Reviewer contract path, then refers to the accepted first Planner turn in the same bound conversation without repeating those semantics. Exact serialized controls and SHA-256 fingerprints are persisted per iteration. The local TaskSpec is authoritative; the conversation is only a semantic cache.

Stable role policy lives in `docs/contracts/planner-v1.md` and `docs/contracts/reviewer-v1.md`, resolved through the selected Data Plane at immutable `BASE_REF`. C2C/1 and generic parsing are unchanged.

New compact projections have a product limit of 8192 UTF-8 bytes measured over the complete serialized envelope. An oversized projection fails deterministically with `C2C_PAYLOAD_TOO_LARGE` before Browser connection or pending-send mutation. Content is never truncated, split, or weakened. Legacy unscoped Browser sends and historical tasks retain existing behavior and require no migration.

If the bound conversation becomes unavailable, the task fails closed. Phase 1 does not implement automatic or explicit rebind, attachments, a TaskContextProvider, arbitrary-size composer transport, LOCAL MCP, encryption, key management, or raw-request hash-only retention.

## Consequences

- Browser automation remains a small replaceable Control Plane adapter.
- GitHub and future MCP remain the repository context authorities.
- Task semantics become durable and independently auditable without upgrading Frozen run checkpoints.
- Compact payload construction must preserve every required literal and constraint or fail before sending.
- A later amendment design can add append-only semantic changes without rewriting Phase-1 TaskSpec evidence.

## Freeze evidence

The frozen implementation baseline is `61d08dd77a7b1873cc11658535a42c72cc86d56f`. Real Desktop acceptance task `m3-compact-control-dogfood-20260902` completed the Compact Planner/Reviewer lifecycle, including one genuine Reviewer finding and the Frozen M3.1 multi-round fix path, at final immutable review ref `c42122044236e7878e69e48ca3c2273eaf81115e` with durable state `DONE` iteration 2 and 338 of 338 tests passing. The acceptance verified local TaskSpec authority, the bounded Compact Browser boundary, immutable GitHub review identity, and named-session reuse. Its dogfood branch remains unmerged as acceptance evidence; the implementation baseline above remains authoritative.
