import { access } from 'node:fs/promises';
import process from 'node:process';
import console from 'node:console';
import { fileURLToPath, URL } from 'node:url';

const cli = new URL('../node_modules/codex-duet/dist/cli/index.js', import.meta.url);
try {
  await access(cli);
} catch {
  console.error('Skill runtime is not installed. Run npm run setup in the skill directory.');
  process.exit(1);
}
// Keep the caller's cwd, arguments, signals and exit status. Never use a global fallback.
process.argv[1] = fileURLToPath(cli);
await import(cli.href);
