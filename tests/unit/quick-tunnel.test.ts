import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { QuickTunnel, type TunnelProcess } from '../../src/local/quick-tunnel.js';

function fixture() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => {
    queueMicrotask(() => child.emit('exit', 0));
    return true;
  });
  const spawn = vi.fn(() => child as unknown as TunnelProcess);
  return { child, spawn };
}

describe('owned Quick Tunnel', () => {
  it('passes structured args, parses bounded lines, and stops only its own child', async () => {
    const { child, spawn } = fixture();
    const loss = vi.fn();
    const tunnel = new QuickTunnel('C:/Program Files/cloudflared.exe', spawn);
    const started = tunnel.start('http://127.0.0.1:12345', loss);
    child.stderr.write('x'.repeat(5000) + ' https://ignored.trycloudflare.com\n');
    child.stderr.write(' | https://gentle-river.trycloud');
    child.stderr.write('flare.com |\n');
    expect(await started).toBe('https://gentle-river.trycloudflare.com');
    expect(spawn).toHaveBeenCalledWith('C:/Program Files/cloudflared.exe', [
      'tunnel',
      '--no-autoupdate',
      '--url',
      'http://127.0.0.1:12345',
    ]);
    await tunnel.close();
    expect(child.kill).toHaveBeenCalledOnce();
    expect(loss).not.toHaveBeenCalled();
    await expect(tunnel.start('http://127.0.0.1:12345', loss)).rejects.toThrow();
  });

  it('reports identity changes and unexpected child loss without fallback', async () => {
    const { child, spawn } = fixture();
    const loss = vi.fn();
    const tunnel = new QuickTunnel('cloudflared', spawn);
    const started = tunnel.start('http://127.0.0.1:12345', loss);
    child.stdout.write('https://first.trycloudflare.com\n');
    await started;
    child.stdout.write('https://second.trycloudflare.com\n');
    expect(loss).toHaveBeenCalledOnce();
    child.emit('exit', 1);
    expect(loss).toHaveBeenCalledTimes(2);
    await tunnel.close();
  });

  it('rejects startup errors with redacted errors and cleans up on timeout', async () => {
    const { child, spawn } = fixture();
    const tunnel = new QuickTunnel('cloudflared', spawn, 10);
    const started = tunnel.start('http://127.0.0.1:12345', vi.fn());
    child.stderr.write('https://lookalike.trycloudflare.com.evil.test/\n');
    await expect(started).rejects.toThrow('tunnel_unavailable');
    expect(child.kill).toHaveBeenCalledOnce();
    const other = fixture();
    const failed = new QuickTunnel('missing', other.spawn);
    const result = failed.start('http://127.0.0.1:12345', vi.fn());
    other.child.emit('error', new Error('sensitive process diagnostics'));
    await expect(result).rejects.toThrow('tunnel_unavailable');
  });

  it('refuses non-loopback or shell launch targets before spawning', async () => {
    const { spawn } = fixture();
    expect(() => new QuickTunnel('evil.cmd', spawn)).toThrow();
    await expect(
      new QuickTunnel('cloudflared', spawn).start('http://example.com:12345', vi.fn()),
    ).rejects.toThrow();
    expect(spawn).not.toHaveBeenCalled();
  });
});
