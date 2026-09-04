import { spawn } from 'node:child_process';

// Private child entry point, reached only through QuickTunnel's owned IPC channel.
// Parent disconnect (including a crash) tears down cloudflared instead of orphaning it.
const [file, ...args] = process.argv.slice(2);
if (!process.send || !file) process.exit(1);
const child = spawn(file, args, {
  shell: false,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stopping = false;
let timer: ReturnType<typeof setTimeout> | undefined;
function stop() {
  if (stopping) return;
  stopping = true;
  child.kill();
  timer = setTimeout(() => child.kill('SIGKILL'), 2000);
}
process.once('disconnect', stop);
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
child.stdout?.pipe(process.stdout);
child.stderr?.pipe(process.stderr);
child.once('error', () => {
  clearTimeout(timer);
  process.exit(1);
});
child.once('exit', (code) => {
  clearTimeout(timer);
  process.exit(code ?? 1);
});
// Detect an IPC disconnect that happened while creating the child.
if (!process.connected) stop();
