import { fork, type ChildProcess } from 'node:child_process';
import { OAuthFailure } from './remote-oauth.js';

export interface TunnelProcess extends Pick<ChildProcess, 'once' | 'kill' | 'stdout' | 'stderr'> {
  disconnect?: () => void;
  connected?: boolean;
}
export type TunnelSpawn = (file: string, args: string[]) => TunnelProcess;

/** Owns only the child it spawned. No persisted PID adoption or reconnect fallback. */
export class QuickTunnel {
  private child: TunnelProcess | undefined;
  private exited: Promise<void> | undefined;
  private stopping = false;
  private used = false;

  constructor(
    private readonly file: string,
    private readonly launch: TunnelSpawn = (file, args) =>
      fork(new URL('./tunnel-supervisor.js', import.meta.url), [file, ...args], {
        ...{ windowsHide: true },
        silent: true,
        execArgv: [],
      }),
    private readonly startupTimeout = 30_000,
  ) {
    if (!file || /[\r\n\0]/.test(file) || /\.(cmd|bat|ps1)$/i.test(file))
      throw new OAuthFailure('invalid_tunnel_executable');
  }

  async start(localUrl: string, onLoss: () => void): Promise<string> {
    if (this.used || this.stopping) throw new OAuthFailure('tunnel_already_started');
    const url = new URL(localUrl);
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      !url.port ||
      url.href !== `${localUrl}/`
    )
      throw new OAuthFailure('invalid_tunnel_target');
    this.used = true;
    const child = this.launch(this.file, ['tunnel', '--no-autoupdate', '--url', localUrl]);
    this.child = child;
    let didExit = false;
    let resolveExit!: () => void;
    this.exited = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    let origin: string | undefined;
    let rejectReady!: (reason: Error) => void;
    const failure = () => {
      rejectReady(new OAuthFailure('tunnel_unavailable', 503));
      if (!this.stopping) onLoss();
    };
    try {
      return await new Promise<string>((resolve, reject) => {
        rejectReady = reject;
        const timer = setTimeout(failure, this.startupTimeout);
        const exit = () => {
          if (didExit) return;
          didExit = true;
          clearTimeout(timer);
          resolveExit();
          failure();
        };
        child.once('error', exit);
        child.once('exit', exit);
        for (const stream of [child.stdout, child.stderr]) {
          if (!stream) continue;
          let buffered = '';
          let discard = false;
          stream.on('data', (chunk: Buffer) => {
            // Parse bounded lines without ever publishing cloudflared logs.
            for (const char of chunk.toString('utf8')) {
              if (char === '\n') {
                if (!discard) {
                  const match = buffered.match(
                    /https:\/\/([a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com)(?=[\s|]|$)/,
                  );
                  if (match) {
                    const candidate = `https://${match[1]}`;
                    if (origin && origin !== candidate) failure();
                    else if (!origin) {
                      origin = candidate;
                      clearTimeout(timer);
                      resolve(origin);
                    }
                  }
                }
                buffered = '';
                discard = false;
              } else if (!discard) {
                buffered += char;
                if (buffered.length > 4096) {
                  buffered = '';
                  discard = true;
                }
              }
            }
          });
        }
      });
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (!child || !this.exited) return;
    if (child.disconnect && child.connected) child.disconnect();
    else if (!child.disconnect) child.kill();
    if (!(await boundedExit(this.exited, 3000))) {
      child.kill('SIGKILL');
      if (!(await boundedExit(this.exited, 3000)))
        throw new OAuthFailure('tunnel_stop_unconfirmed', 503);
    }
    this.child = undefined;
  }
}

async function boundedExit(exited: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      exited.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
