import { ChatbridgeError } from '../core/errors.js';
import { parseEnvelope } from '../core/protocol.js';
import type { ResponseIngressRequest } from '../duet/response-ingress.js';
import { canonicalJson } from '../duet/task-spec.js';
import { LocalMcpCapabilityStore } from './capability-store.js';
import { LocalLifecycle, type LocalLifecycleGates } from './lifecycle.js';
import { StoredLocalLifecycleGates } from './lifecycle-gates.js';
import type { LocalCodeProvider, LocalSnapshotAuthority } from './local-code-provider.js';

/** Explicit server-side adapter; credentials are request-local, never saved in run/control files. */
export class LocalMcpLifecycleIngress {
  constructor(
    private readonly root: string,
    private readonly provider: LocalCodeProvider,
    private readonly snapshots: LocalSnapshotAuthority,
    private readonly capabilities: LocalMcpCapabilityStore,
  ) {}

  async accept(
    input: ResponseIngressRequest,
    credentialInput: { capabilityId: string; token: string },
  ) {
    const request = { ...input };
    const credential = { ...credentialInput };
    if (request.source !== 'MCP')
      throw new ChatbridgeError('MCP adapter requires MCP source', 'LOCAL_MCP_SOURCE_INVALID');
    const authorize = () =>
      this.capabilities.authorize({
        ...credential,
        taskId: request.taskId,
        iteration: request.iteration,
        controlSha256: request.controlSha256,
      });
    // Even historical replay must authenticate before touching the shared lifecycle.
    await authorize();
    const stored = new StoredLocalLifecycleGates(this.root);
    const gates: LocalLifecycleGates = {
      assertPlanningReady: (spec, policy) => stored.assertPlanningReady(spec, policy),
      assertControlConfirmed: (task, hash, policy, identity) =>
        stored.assertControlConfirmed(task, hash, policy, identity),
      assertResponseReceived: async (current, policy) => {
        if (canonicalJson(current) !== canonicalJson(request))
          throw new ChatbridgeError('MCP request authority mismatch', 'LOCAL_MCP_SOURCE_INVALID');
        await authorize(); // Rechecked under the shared ingress task lock, not a process-wide bypass.
        const envelope = parseEnvelope(current.response);
        await stored.assertControlConfirmed(current.taskId, current.controlSha256, policy, {
          kind: envelope.testStatus === undefined ? 'PLANNER' : 'REVIEWER',
          iteration: current.iteration,
        });
      },
    };
    return new LocalLifecycle(this.root, this.provider, this.snapshots, gates).ingest(request);
  }
}
