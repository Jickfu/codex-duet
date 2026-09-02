import path from 'node:path';
import process from 'node:process';
import type { TestStatus } from '../core/domain.js';
import { GitRunner } from '../github/git-runner.js';
import { GitHubCodeProvider } from '../github/github-code-provider.js';
import { DuetOrchestrator } from '../duet/orchestrator.js';
import { DuetRunStore } from '../duet/run-store.js';
import { GitReviewHistoryVerifier } from '../duet/review-history-verifier.js';
import { ExecutionStore } from '../duet/execution-store.js';
import { GitExecutionWorkspaceInspector } from '../duet/execution-workspace-inspector.js';
import { TaskOperationLock } from '../duet/task-operation-lock.js';
import { TaskSpecStore } from '../duet/task-spec-store.js';
import { TaskContextStore } from '../duet/task-context-store.js';
import { TaskInteractionPolicyStore } from '../duet/interaction-policy-store.js';
import { CodexBrowserControlStore } from '../duet/codex-browser-control-store.js';
import { InteractionService } from '../duet/interaction-service.js';
import { DiscussionStore } from '../duet/discussion-store.js';
import { DiscussionService } from '../duet/discussion-service.js';
import { loadConfig } from '../config/config.js';
import { TaskBrowserStore } from '../browser/task-browser-store.js';
import { ConversationBindingLock } from '../browser/conversation-binding-lock.js';

function orchestrator(): DuetOrchestrator {
  const cwd = process.cwd();
  const stateRoot = path.join(cwd, '.chatbridge');
  const git = new GitRunner(cwd);
  const policies = new TaskInteractionPolicyStore(stateRoot);
  const specs = new TaskSpecStore(stateRoot);
  const discussions = new DiscussionStore(stateRoot);
  const discussion = new DiscussionService(
    new DuetRunStore(stateRoot),
    policies,
    specs,
    discussions,
  );
  return new DuetOrchestrator(
    new GitHubCodeProvider(git, 'origin', stateRoot),
    new DuetRunStore(stateRoot),
    new GitReviewHistoryVerifier(git),
    {
      store: new ExecutionStore(stateRoot),
      inspector: new GitExecutionWorkspaceInspector(git),
      lock: new TaskOperationLock(stateRoot),
    },
    specs,
    new TaskContextStore(stateRoot),
    discussion,
  );
}

function interactionServices() {
  const stateRoot = path.join(process.cwd(), '.chatbridge');
  const policies = new TaskInteractionPolicyStore(stateRoot);
  const discussions = new DiscussionStore(stateRoot);
  return {
    interaction: new InteractionService(
      policies,
      new CodexBrowserControlStore(stateRoot),
      loadConfig().allowedOrigins,
      undefined,
      {
        taskBrowser: new TaskBrowserStore(stateRoot),
        runs: new DuetRunStore(stateRoot),
        lock: new ConversationBindingLock(stateRoot),
      },
    ),
    discussion: new DiscussionService(
      new DuetRunStore(stateRoot),
      policies,
      new TaskSpecStore(stateRoot),
      discussions,
    ),
  };
}

export async function duetInit(
  task: string,
  requestFile: string,
  output: string,
  interactionPolicyFile: string,
  maxIterations?: number,
  taskSpecFile?: string,
): Promise<void> {
  const existing = await new DuetRunStore(path.join(process.cwd(), '.chatbridge')).read(task);
  if (existing) {
    console.log(
      JSON.stringify(
        await orchestrator().init(task, requestFile, output, maxIterations ?? 8, taskSpecFile),
        null,
        2,
      ),
    );
    return;
  }
  await interactionServices().interaction.initialize(task, interactionPolicyFile);
  console.log(
    JSON.stringify(
      await orchestrator().init(task, requestFile, output, maxIterations ?? 8, taskSpecFile),
      null,
      2,
    ),
  );
}

export async function duetIngest(task: string, messageFile: string): Promise<void> {
  console.log(JSON.stringify(await orchestrator().ingest(task, messageFile), null, 2));
}

export async function duetBeginExecution(task: string): Promise<void> {
  console.log(JSON.stringify(await orchestrator().beginExecution(task), null, 2));
}

export async function duetPrepareReview(
  task: string,
  tests: TestStatus,
  output: string,
): Promise<void> {
  console.log(JSON.stringify(await orchestrator().prepareReview(task, tests, output), null, 2));
}

export async function duetRecordTests(task: string, status: TestStatus): Promise<void> {
  console.log(JSON.stringify(await orchestrator().recordTests(task, status), null, 2));
}

export async function duetReconcileExecution(task: string): Promise<void> {
  console.log(JSON.stringify(await orchestrator().reconcileExecution(task), null, 2));
}

export async function duetMarkReviewing(task: string): Promise<void> {
  console.log(JSON.stringify(await orchestrator().markReviewing(task), null, 2));
}

export async function duetStatus(task: string): Promise<void> {
  console.log(JSON.stringify(await orchestrator().status(task), null, 2));
}

export async function duetInteractionInit(task: string, policyFile: string): Promise<void> {
  console.log(
    JSON.stringify(await interactionServices().interaction.initialize(task, policyFile), null, 2),
  );
}

export async function duetCodexBrowserPrepare(
  task: string,
  messageFile: string,
  kind: 'DISCUSSION' | 'PLANNER' | 'REVIEWER',
  iteration: number,
  round?: number,
): Promise<void> {
  console.log(
    JSON.stringify(
      await interactionServices().interaction.prepareCodexBrowser(task, messageFile, {
        kind,
        iteration,
        ...(round ? { round } : {}),
      }),
      null,
      2,
    ),
  );
}

export async function duetCodexBrowserComplete(
  task: string,
  outcome: 'CONFIRMED' | 'OUTCOME_UNKNOWN',
  conversationUrl?: string,
): Promise<void> {
  console.log(
    JSON.stringify(
      await interactionServices().interaction.completeCodexBrowser(task, outcome, conversationUrl),
      null,
      2,
    ),
  );
}

export async function duetCodexBrowserMarkAttempted(task: string): Promise<void> {
  console.log(
    JSON.stringify(
      await interactionServices().interaction.markCodexBrowserAttempted(task),
      null,
      2,
    ),
  );
}

export async function duetCodexBrowserReceive(task: string, responseFile: string): Promise<void> {
  console.log(
    JSON.stringify(
      await interactionServices().interaction.recordCodexBrowserResponse(task, responseFile),
      null,
      2,
    ),
  );
}

export async function duetDiscussionPrepare(
  task: string,
  requestFile: string,
  output: string,
): Promise<void> {
  console.log(
    JSON.stringify(
      await interactionServices().discussion.prepare(task, requestFile, output),
      null,
      2,
    ),
  );
}

export async function duetDiscussionIngest(task: string, messageFile: string): Promise<void> {
  console.log(
    JSON.stringify(await interactionServices().discussion.ingest(task, messageFile), null, 2),
  );
}
