import path from 'node:path';
import process from 'node:process';
import { PlaywrightCliRunner } from '../browser/playwright-cli-runner.js';
import { RuntimeStore } from '../browser/runtime-store.js';

export async function detach() {
  const store = new RuntimeStore(path.resolve(process.cwd(), '.chatbridge'));
  const runtime = await store.read();
  if (!runtime) {
    console.log('No browser runtime is attached.');
    return;
  }
  if (runtime.transport === 'cli')
    await new PlaywrightCliRunner().run([`--session=${runtime.session!}`, 'detach'], 5000);
  await store.clear();
  console.log(
    runtime.transport === 'cli'
      ? 'Detached; the existing browser remains running.'
      : 'Managed runtime checkpoint cleared.',
  );
}
