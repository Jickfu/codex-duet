import path from 'node:path';
import type { Command } from 'commander';
import { z } from 'zod';
import { ChatbridgeError } from '../core/errors.js';
import { TaskIdSchema } from '../core/domain.js';
import { DuetRunStore } from '../duet/run-store.js';
import { LocalPlaywrightTransport } from '../local/playwright-transport.js';
import { GitLocalSnapshotAuthority } from '../local/git-snapshot-authority.js';
import { LocalCodeProvider } from '../local/local-code-provider.js';
import { LocalEvidenceStore } from '../local/evidence-store.js';
import { LocalLifecycle } from '../local/lifecycle.js';
import { LocalDiscussion } from '../local/discussion.js';
import { StoredLocalLifecycleGates } from '../local/lifecycle-gates.js';
import { localTaskActivity, localMcpControlCompleted } from '../local/activity.js';
import { runtime } from './runtime.js';

export function localPlaywright(workspace: string) {
  const root = path.join(workspace, '.chatbridge');
  return new LocalPlaywrightTransport({
    root,
    completedControl: (record) => localMcpControlCompleted(workspace, record),
    connect: (conversationUrl) => runtime({ conversationUrl }),
    activity: {
      getState: async (taskId) => {
        const github = await new DuetRunStore(root).read(taskId);
        const local = await localTaskActivity(workspace, taskId);
        if (github && local)
          throw new ChatbridgeError('Conflicting task modes', 'LOCAL_TASK_MODE_CONFLICT');
        return github?.state ?? local;
      },
    },
    outbound: async (taskId, selection) => {
      const snapshots = await GitLocalSnapshotAuthority.open(workspace, taskId);
      const provider = new LocalCodeProvider(snapshots, new LocalEvidenceStore(root), root);
      if (selection.round !== undefined) {
        const discussion = new LocalDiscussion(
          root,
          provider,
          snapshots,
          selection.supplement ? 'supplement' : 'primary',
        );
        return {
          content: await discussion.outbound(taskId, selection.round),
          kind: 'DISCUSSION',
          iteration: 1,
          round: selection.round,
        };
      }
      if (selection.supplement)
        throw new ChatbridgeError(
          'Supplement requires a Discussion round',
          'DISCUSSION_STATE_INVALID',
        );
      const run = await new LocalLifecycle(
        root,
        provider,
        snapshots,
        new StoredLocalLifecycleGates(root),
      ).status(taskId);
      if (!['PLANNING', 'EXECUTED', 'REVIEWING'].includes(run.state))
        throw new ChatbridgeError('No pending LOCAL control to send', 'LOCAL_STATE_INVALID');
      const latest = run.reviews.at(-1);
      await snapshots.assertLiveSnapshot(
        latest?.reviewSnapshotId ?? run.spec.context.baselineSnapshotId,
      );
      return {
        content: run.control,
        kind: run.state === 'PLANNING' ? 'PLANNER' : 'REVIEWER',
        iteration: run.iteration,
      };
    },
  });
}

export function registerLocalPlaywrightCommands(
  local: Command,
  cwd: () => string,
  report: (value: unknown) => void,
) {
  local
    .command('browser-send')
    .description(
      'Send the exact stored LOCAL control through selected Playwright; never retries an attempt',
    )
    .requiredOption('--task <id>')
    .option(
      '--conversation-url <url>',
      'required for the first send; stable ChatGPT conversation only',
    )
    .option('--round <n>', 'send a prepared Discussion round instead of the lifecycle control')
    .option('--supplement', 'select the authorized supplemental Discussion segment')
    .action(
      async (o: {
        task: string;
        conversationUrl?: string;
        round?: string;
        supplement?: boolean;
      }) => {
        const taskId = TaskIdSchema.parse(o.task);
        await GitLocalSnapshotAuthority.open(cwd(), taskId); // Validate state-root containment before locking.
        const selection = {
          ...(o.round === undefined
            ? {}
            : { round: z.coerce.number().int().min(1).max(3).parse(o.round) }),
          ...(o.supplement ? { supplement: true } : {}),
        };
        report(await localPlaywright(cwd()).send(taskId, selection, o.conversationUrl));
      },
    );
  local
    .command('browser-wait')
    .description(
      'Persist the exact response to a confirmed LOCAL Playwright send; never ingests or resends',
    )
    .requiredOption('--task <id>')
    .option('--timeout <ms>', 'bounded wait, up to 120000 ms', '120000')
    .action(async (o: { task: string; timeout: string }) => {
      const taskId = TaskIdSchema.parse(o.task);
      await GitLocalSnapshotAuthority.open(cwd(), taskId);
      const response = await localPlaywright(cwd()).wait(
        taskId,
        z.coerce.number().int().min(1).max(120000).parse(o.timeout),
      );
      report({ taskId, response });
    });
}
