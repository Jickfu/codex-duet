import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('reaps the tunnel when the owning parent is forcibly terminated', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'duet-supervisor-'));
  const supervisor = path.join(root, 'supervisor.mjs');
  const child = path.join(root, 'child.mjs');
  const parent = path.join(root, 'parent.mjs');
  await writeFile(
    supervisor,
    ts.transpileModule(
      await readFile(new URL('../../src/local/tunnel-supervisor.ts', import.meta.url), 'utf8'),
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } },
    ).outputText,
  );
  // Bounded fixture also self-terminates if an assertion fails.
  await writeFile(child, 'console.log(process.pid); setTimeout(() => process.exit(99), 8000);');
  await writeFile(
    parent,
    `import { fork } from 'node:child_process';
const worker = fork(process.argv[2], [process.execPath, process.argv[3]], { silent: true });
worker.stdout.on('data', data => process.send({ pid: Number(data.toString().trim()) }));
worker.on('exit', () => process.exit(0));
`,
  );
  const owner = fork(parent, [supervisor, child], { silent: true, execArgv: [] });
  try {
    const [message] = (await once(owner, 'message')) as [{ pid: number }];
    expect(message.pid).toBeGreaterThan(0);
    process.kill(message.pid, 0); // Read-only liveness check of the fixture's reported PID.
    const exited = once(owner, 'exit');
    owner.kill('SIGKILL');
    await exited;
    await expect
      .poll(
        () => {
          try {
            process.kill(message.pid, 0);
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 4000, interval: 50 },
      )
      .toBe(false);
  } finally {
    owner.kill();
  }
}, 12_000);
