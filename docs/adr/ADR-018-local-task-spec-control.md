# ADR-018: LOCAL TaskSpec and compact control identity

Status: implemented building blocks; full LOCAL lifecycle integration pending.

## Decision

Keep frozen GITHUB TaskSpec, Planner/Reviewer contracts and C2C/1 headers unchanged. Add `LocalTaskSpecV1` with the same semantic fields, but a required LOCAL context (task, workspace and baseline snapshot) and contract resolution `AT_BASELINE_SNAPSHOT`. Its contract paths are `docs/contracts/local-planner-v1.md` and `docs/contracts/local-reviewer-v1.md`.

The canonical integrity fingerprint excludes only the integrity field. Binding validates the raw request hash, exact literals, context and fingerprint, then verifies both contract blobs in the immutable baseline. It also checks compact Planner projection size and live baseline equality before publishing immutable semantics under `.chatbridge/runs/<task>/local/task-spec.json`. A later amendment is not silently accepted. Existing GITHUB task-spec files are not overwritten.

## Projection and response identity

Use unchanged C2C/1 with MODE: LOCAL and role-specific JSON content. Both roles receive complete semantic fields, not an instruction to reconstruct them from conversation history. Contract files and repository source stay on the snapshot-bound MCP Data Plane. The complete serialized request, including all headers and metadata, must fit the existing 8192 UTF-8 byte ceiling. Oversize content is rejected, never truncated.

The JSON identity includes task, mode, workspace, baseline snapshot, TaskSpec fingerprint and requested iteration. Review additionally includes the entire fingerprint-validated LOCAL review target. Response content must contain exactly the echoed identity and a nonempty result string. GitHub headers are forbidden. Initial planning permits PLAN/BLOCKED/FAILED, not DONE. Review permits DONE/PLAN/BLOCKED/FAILED and must echo TEST_STATUS. A correction PLAN advances the outer iteration to N+1 but preserves the reviewed identity at N.

Identity validation is not response acceptance, execution authorization or an independent lifecycle. The future durable ingress must call it with the stored TaskSpec and current prepared target before applying transitions, together with the required live-state guards and interaction policy. This checkpoint does not connect Browser or optional Discussion, mark a task REVIEWING, or send a message.

## CLI consequences

`local bind-task-spec` is explicit and requires an initialized, unchanged baseline with no prepared reviews. Store its request/spec input files under `.chatbridge` or outside the captured workspace. Identical early binding is idempotent.

`local project-control` returns JSON containing an envelope; it does not send it. Initial projection checks live baseline equality and rejects use after reviews exist. `--review` only projects the latest already-prepared target, revalidating its exact persisted evidence. It never implicitly prepares a new target. Review projection can recover immutable bytes despite later live edits; it does not authorize execution against those edits.

Repositories using this feature must include both LOCAL contract files before baseline capture. Source content at baseline is authoritative; missing or empty contracts fail closed rather than falling back to live files or GITHUB contracts.
