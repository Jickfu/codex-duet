import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import process from 'node:process';
import { promisify } from 'node:util';
import { parseGitHubRemote } from '../github/domain.js';
import { installationReadiness } from './readiness.js';

export type OnboardingMode = 'github' | 'local';
type Check = { name: string; status: 'PASS' | 'FAIL' | 'REQUIRED'; next: string };

export async function onboarding(
  mode: OnboardingMode,
  cwd = process.cwd(),
  dependencies = {
    installation: installationReadiness,
    git: async (args: string[]) => {
      const result = await promisify(execFile)('git', ['--no-optional-locks', ...args], {
        cwd,
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      return result.stdout.trim();
    },
  },
) {
  const checks: Check[] = [];
  const installation = await dependencies.installation();
  checks.push({
    name: 'installation',
    status: installation.ready ? 'PASS' : 'FAIL',
    next: installation.ready
      ? 'Installed prerequisites passed'
      : 'Run chatbridge doctor and resolve missing prerequisites',
  });
  async function check(name: string, inspect: () => Promise<boolean>, next: string) {
    let pass = false;
    try {
      pass = await inspect();
    } catch {
      /* Report actionable guidance, never raw Git errors. */
    }
    checks.push({
      name,
      status: pass ? 'PASS' : 'FAIL',
      next: pass ? 'Local prerequisite passed' : next,
    });
  }
  await check(
    'projectRoot',
    async () =>
      (await realpath(await dependencies.git(['rev-parse', '--show-toplevel']))) ===
      (await realpath(cwd)),
    'Run from the target Git worktree root; do not initialize a repository automatically',
  );
  await check(
    'head',
    async () => /^[0-9a-f]{40}$/.test(await dependencies.git(['rev-parse', '--verify', 'HEAD'])),
    'The target project needs an existing committed baseline; decide its contents before committing',
  );
  if (mode === 'github') {
    await check(
      'origin',
      async () => {
        parseGitHubRemote(await dependencies.git(['remote', 'get-url', 'origin']));
        return true;
      },
      'Configure the intended GitHub origin after confirming the target repository; access has not been tested',
    );
    await check(
      'cleanWorktree',
      async () => (await dependencies.git(['status', '--porcelain=v1', '-uall'])) === '',
      'Review existing changes and installed skill files; decide how to version them. Never stash, reset or commit automatically',
    );
  }
  for (const role of ['planner', 'reviewer']) {
    const contract = `docs/contracts/${mode === 'local' ? 'local-' : ''}${role}-v1.md`;
    await check(
      contract,
      async () =>
        (await dependencies.git(['cat-file', '-t', `HEAD:${contract}`])) === 'blob' &&
        Number(await dependencies.git(['cat-file', '-s', `HEAD:${contract}`])) > 0,
      `Inspect ${contract} in the committed baseline. If absent, propose copying the bundled contract as a separate setup change; do not overwrite existing contracts`,
    );
  }
  if (mode === 'github')
    checks.push({
      name: 'githubAccess',
      status: 'REQUIRED',
      next: 'Verify the intended account can access the target repository and ChatGPT can read the formal GitHub review refs. No network access check was performed',
    });
  else
    checks.push({
      name: 'localDataAccess',
      status: 'REQUIRED',
      next: 'Follow docs/local-mode.md and docs/remote-local-mode.md to configure snapshot access and explicitly approve any remote OAuth request',
    });
  checks.push({
    name: 'browser',
    status: 'REQUIRED',
    next: 'Choose CODEX_BROWSER or PLAYWRIGHT_CLI before task setup. Confirm the intended ChatGPT login and conversation using that provider; do not send or switch providers automatically',
  });
  return {
    mode,
    localPrerequisitesReady: !checks.some((c) => c.status === 'FAIL'),
    taskReady: false,
    checks,
    scope:
      'Read-only first-use guidance. Contract presence is checked at HEAD, not semantic correctness. No network, browser, task initialization or project mutation.',
    next: 'Resolve FAIL checks, verify REQUIRED external prerequisites, then follow the selected mode workflow. For existing tasks inspect durable status and resume; never initialize them again.',
  };
}

export async function onboardingCommand(options: { mode: OnboardingMode }) {
  const report = await onboarding(options.mode);
  console.log(JSON.stringify(report, null, 2));
  if (!report.localPrerequisitesReady) process.exitCode = 1;
}
