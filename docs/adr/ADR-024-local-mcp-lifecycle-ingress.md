# ADR-024: Authenticated LOCAL MCP lifecycle response ingress

Status: implemented and locally testable; M4 not frozen.

## Wiring and authority

`LocalMcpServer` remains loopback-only and exposes exactly eight read tools by default. Optional submit_response still requires explicit `enabled: true` and a high-entropy capability bound to task, iteration and exact control digest. The server authenticates before dispatching. Its response-sink interface additionally supplies request-local credentials to `LocalMcpLifecycleIngress`; the existing lower-level ResponseIngressService composition remains available for library callers.

The LOCAL adapter independently authenticates before entering `LocalLifecycle.ingest`, including historical replay. For a new response it reauthenticates during preflight and again during application under the shared task lock. Credentials are closure-local to a single request, not a global allow-MCP switch, caller success flag or persisted token. Capability IDs must also match their durable file identity.

All ordinary lifecycle checks remain: current control and iteration, strict LOCAL semantic/snapshot/decision identity, confirmed selected Browser send, phase, iteration limit and live snapshot before PLAN acceptance. MCP receipt replaces the requirement for a Browser inbound artifact, not the outbound send gate. PREPARED, ATTEMPTED and OUTCOME_UNKNOWN are not confirmed sends. The default CLI Browser ingress still rejects fresh MCP-source responses; it does not gain an ambient bypass.

The same private shared ingress performs acceptance and deduplication. Browser-first and MCP-first winners are preserved. Identical historical responses are replayable; different bytes cannot overwrite the first accepted response. PENDING failures are not completed controls, and matching authenticated retries can finish run-commit-before-ingress-acceptance recovery. A cancelled run cannot accept a new response.

## Browser continuation without invented receipt

MCP acceptance does not set Browser state to RESPONDED, create a Browser response artifact or record an inbound Browser digest. An optional completion observer in InteractionService permits a next operation only when validated LOCAL run history and its exact ACCEPTED, MCP-source ingress receipt agree for the currently CONFIRMED control. It verifies stored policy/send identity and refuses mode conflict. Missing/PENDING/mismatched receipt cannot release the next operation. Re-preparing the same completed control is refused rather than resending it.

The CLI wires this observer only for LOCAL state. Default callers without it retain existing behavior, and frozen Browser schemas and GITHUB orchestration are unchanged. The observer is not an execution authorization or a new response authority.

## Composition boundary

The explicit library composition is:

```typescript
const capabilities = new LocalMcpCapabilityStore(stateRoot);
const ingress = new LocalMcpLifecycleIngress(stateRoot, provider, snapshots, capabilities);
const server = new LocalMcpServer({
  workspace: workspaceService,
  submitResponse: { enabled: true, capabilities, ingress },
});
```

Issue a capability for the exact intended control through LocalMcpCapabilityStore and pass its secret only through a trusted local channel. Only its digest is persisted in the capability store. Do not commit it, add it to control envelopes, or log it. This stage does not add automatic capability issuance, token distribution, a background-server CLI or public endpoint. Existing capabilities are not automatically expired/revoked; lifecycle state and control binding prevent them from authorizing unrelated or divergent responses.

Local acceptance uses real Git and a real loopback MCP client/server with fixture Browser confirmations. It is not live ChatGPT-Web LOCAL acceptance. Workspace tools remain read-only, tests/edits remain executor-owned, and remote exposure/cloudflared remain M5.
