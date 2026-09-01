import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import { ChatbridgeError } from '../core/errors.js';

const execFileAsync = promisify(execFile);
export interface CliRunResult {
  stdout: string;
  stderr: string;
}
export interface PlaywrightCliRunnerLike {
  run(args: readonly string[], timeoutMs?: number): Promise<CliRunResult>;
}
export class PlaywrightCliRunner implements PlaywrightCliRunnerLike {
  private readonly entry: string;
  constructor() {
    const require = createRequire(import.meta.url);
    this.entry = path.join(
      path.dirname(require.resolve('@playwright/cli/package.json')),
      'playwright-cli.js',
    );
  }
  async run(args: readonly string[], timeoutMs = 15_000): Promise<CliRunResult> {
    try {
      const { stdout, stderr } = await execFileAsync(process.execPath, [this.entry, ...args], {
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      });
      return { stdout, stderr };
    } catch (error: any) {
      const diagnostic = `${String(error?.stdout ?? '')}\n${String(error?.stderr ?? '')}`;
      if (diagnostic.includes('ORIGIN_DENIED'))
        throw new ChatbridgeError('Page navigated outside the allowlisted origin', 'ORIGIN_DENIED');
      const timedOut = error?.killed || error?.code === 'ETIMEDOUT';
      throw new ChatbridgeError(
        timedOut ? 'Playwright CLI operation timed out' : 'Playwright CLI operation failed',
        'PLAYWRIGHT_CLI_FAILED',
      );
    }
  }
}
