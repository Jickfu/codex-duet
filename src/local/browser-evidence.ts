import path from 'node:path';
import { ChatbridgeError } from '../core/errors.js';
import { CodexBrowserControlStore } from '../duet/codex-browser-control-store.js';
import type { TaskInteractionPolicyV1 } from '../duet/interaction-policy.js';
import { LocalPlaywrightProofStore } from './playwright-proof.js';

type Provider = TaskInteractionPolicyV1['browserControlProvider'];
export async function localBrowserRecord(root: string, taskId: string, provider: Provider) {
  if (provider === 'CODEX_BROWSER') return new CodexBrowserControlStore(root).read(taskId);
  const proof = await new LocalPlaywrightProofStore(root).read(taskId);
  if (!proof)
    throw new ChatbridgeError(
      'Exact Playwright proof is missing',
      'LOCAL_TRANSPORT_PROOF_UNAVAILABLE',
    );
  return proof;
}
export function localBrowserResponsePath(
  root: string,
  taskId: string,
  provider: Provider,
  operationId: string,
) {
  return provider === 'CODEX_BROWSER'
    ? path.join(root, 'runs', taskId, 'codex-browser', operationId, 'response.txt')
    : new LocalPlaywrightProofStore(root).artifactPath(taskId, operationId, 'response');
}
