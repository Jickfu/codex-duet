import { createInterface } from 'node:readline';
import type { Command } from 'commander';
import { ChatbridgeError } from '../core/errors.js';
import { openRemoteWorkspace } from '../local/remote-workspace.js';
import { QuickTunnel } from '../local/quick-tunnel.js';
import { RemoteMcpServer } from '../local/remote-server.js';

export function registerLocalRemoteCommands(local: Command, cwd: () => string): void {
  local
    .command('remote-serve')
    .description('Serve one LOCAL task via temporary HTTPS and local OAuth approval (foreground)')
    .requiredOption('--task <id>')
    .option(
      '--redirect-uri <uri>',
      'exact ChatGPT OAuth redirect URI; override if app settings show a different callback',
      'https://chatgpt.com/connector_platform_oauth_redirect',
    )
    .option(
      '--cloudflared <executable>',
      'installed cloudflared executable; no automatic installation',
      'cloudflared',
    )
    .action(async (options: { task: string; redirectUri: string; cloudflared: string }) => {
      if (!process.stdin.isTTY)
        throw new ChatbridgeError(
          'Run remote-serve in an interactive terminal for local approval',
          'REMOTE_TERMINAL_REQUIRED',
        );
      await serveRemote(cwd(), options);
    });
}

async function serveRemote(
  root: string,
  options: { task: string; redirectUri: string; cloudflared: string },
) {
  const workspace = await openRemoteWorkspace(root, options.task);
  const server = new RemoteMcpServer({
    taskId: options.task,
    ...workspace,
    redirectUri: options.redirectUri,
    onDiagnostic: (event) => console.log(JSON.stringify({ remote: event })),
    onAuthorization: (request) => {
      console.log(
        JSON.stringify({
          authorization: request,
          access:
            'Baseline and current/previous formal review snapshots; read-only; expires after one hour.',
        }),
      );
      console.log(
        `Match the request ID in your browser, then type: approve ${request.id} (or deny ${request.id})`,
      );
    },
  });
  const tunnel = new QuickTunnel(options.cloudflared);
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let shutdown: Promise<void> | undefined;
  let lost = false;
  const stop = () => {
    shutdown ??= (async () => {
      try {
        await server.close();
        await tunnel.close();
      } finally {
        finish();
      }
    })();
    // Always observed again in finally; event callbacks must not leak rejections.
    void shutdown.catch(() => undefined);
  };
  const loss = () => {
    lost = true;
    stop();
  };
  terminal.on('line', (line) => {
    const match = /^(approve|deny) ([a-f0-9-]{36})$/.exec(line.trim());
    if (line.trim() === 'stop') {
      stop();
      return;
    }
    if (!match) {
      console.log('Use approve <request-id>, deny <request-id>, or stop.');
      return;
    }
    try {
      server.decide(match[2]!, match[1] === 'approve');
      console.log('Decision recorded.');
    } catch {
      console.log('Request unavailable, expired, or already decided.');
    }
  });
  terminal.once('close', stop);
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const listener = await server.start();
    const origin = await tunnel.start(listener, loss);
    if (shutdown) throw new ChatbridgeError('Remote startup was interrupted', 'REMOTE_STOPPED');
    server.activate(origin);
    console.log(
      JSON.stringify({
        mcpUrl: `${origin}/mcp`,
        taskId: options.task,
        authentication: 'OAuth / dynamic client registration / public client (none)',
        temporary: true,
      }),
    );
    console.log(
      'Create the ChatGPT connection using this URL. Match each authorization request in your browser before approving. Type stop to revoke access and close the tunnel.',
    );
    await done;
    if (lost)
      throw new ChatbridgeError(
        'Tunnel was lost; access revoked. Restart and reconnect explicitly.',
        'REMOTE_TUNNEL_LOST',
      );
  } finally {
    stop();
    terminal.close();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await shutdown;
  }
}
