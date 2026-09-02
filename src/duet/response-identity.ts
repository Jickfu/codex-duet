import type { Envelope } from '../core/protocol.js';
import { ChatbridgeError } from '../core/errors.js';
import type { DuetRunCheckpointV2 } from './run.js';

export function assertGitHubResponseIdentity(run: DuetRunCheckpointV2, envelope: Envelope): void {
  if (envelope.mode !== run.mode)
    throw new ChatbridgeError('C2C mode does not match run', 'MODE_MISMATCH');
  assertField(
    envelope.repository,
    run.context.repository,
    'C2C repository does not match run',
    'C2C_REPOSITORY_MISMATCH',
  );
  assertField(
    envelope.taskBranch,
    run.context.taskBranch,
    'C2C task branch does not match run',
    'C2C_TASK_BRANCH_MISMATCH',
  );
  assertField(
    envelope.baseRef,
    run.context.baseRef,
    'C2C base ref does not match run',
    'C2C_BASE_REF_MISMATCH',
  );

  if (run.state !== 'REVIEWING') return;
  const current = run.iterations[run.iteration - 1]?.reviewTarget;
  if (!current)
    throw new ChatbridgeError(
      'Current durable review identity is unavailable',
      'C2C_CONTEXT_REQUIRED',
    );
  assertField(
    envelope.reviewRef,
    current.reviewRef,
    'C2C review ref does not match current durable review',
    'C2C_REVIEW_REF_MISMATCH',
  );
  assertField(
    envelope.testStatus,
    current.testStatus,
    'C2C test status does not match current durable review',
    'C2C_TEST_STATUS_MISMATCH',
  );
}

function assertField(
  actual: string | undefined,
  expected: string,
  message: string,
  code: string,
): void {
  if (actual !== expected) throw new ChatbridgeError(message, code);
}
