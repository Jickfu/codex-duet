import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';
import process from 'node:process';

type Check = { name: string; status: 'PASS' | 'FAIL'; detail: string };
export async function installationReadiness(
  dependencies = {
    nodeVersion: process.versions.node,
    git: async () => {
      const { stdout } = await promisify(execFile)('git', ['--version'], {
        windowsHide: true,
        timeout: 3000,
        maxBuffer: 4096,
      });
      return stdout.trim();
    },
    artifact: async (relative: string) => access(new URL(relative, import.meta.url)),
  },
) {
  const checks: Check[] = [];
  const supported =
    /^\d+\.\d+\.\d+$/.test(dependencies.nodeVersion) &&
    Number(dependencies.nodeVersion.split('.')[0]) >= 20;
  checks.push({
    name: 'node',
    status: supported ? 'PASS' : 'FAIL',
    detail: supported ? dependencies.nodeVersion : 'Node.js 20 or newer is required',
  });
  try {
    const version = await dependencies.git();
    if (!/^git version \d+\.\d+[A-Za-z0-9 .()+-]{0,80}$/.test(version))
      throw new Error('Invalid version');
    checks.push({ name: 'git', status: 'PASS', detail: version });
  } catch {
    checks.push({
      name: 'git',
      status: 'FAIL',
      detail: 'Install Git and make git --version available on PATH',
    });
  }
  for (const relative of [
    '../local/tunnel-supervisor.js',
    '../../docs/contracts/local-planner-v1.md',
    '../../docs/contracts/local-reviewer-v1.md',
  ]) {
    try {
      await dependencies.artifact(relative);
      checks.push({ name: relative, status: 'PASS', detail: 'Installed artifact present' });
    } catch {
      checks.push({
        name: relative,
        status: 'FAIL',
        detail: 'Rebuild or reinstall the complete package',
      });
    }
  }
  return {
    ready: checks.every((c) => c.status === 'PASS'),
    checks,
    scope:
      'Offline installation prerequisites only; Browser login, cloudflared, network and task state are not checked',
  };
}

export async function installationDoctor() {
  const result = await installationReadiness();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ready) process.exitCode = 1;
}
