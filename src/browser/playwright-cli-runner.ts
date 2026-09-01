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
    const manifestPath = require.resolve('@playwright/cli/package.json');
    const manifest = require(manifestPath) as { bin?: string | Record<string, string> };
    const relative =
      typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.['playwright-cli'];
    if (!relative)
      throw new ChatbridgeError(
        '@playwright/cli does not declare its public playwright-cli binary',
        'PLAYWRIGHT_CLI_FAILED',
      );
    const packageRoot = path.dirname(manifestPath);
    this.entry = path.resolve(packageRoot, relative);
    if (!this.entry.startsWith(`${packageRoot}${path.sep}`))
      throw new ChatbridgeError('Invalid @playwright/cli bin metadata', 'PLAYWRIGHT_CLI_FAILED');
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
      throw classifyCliFailure(error);
    }
  }
}

export function classifyCliFailure(error: any): ChatbridgeError {
  const diagnostic = `${String(error?.stdout ?? '')}\n${String(error?.stderr ?? '')}`;
  if (error?.killed || error?.code === 'ETIMEDOUT')
    return new ChatbridgeError('Playwright CLI operation timed out', 'PLAYWRIGHT_CLI_TIMEOUT');
  if (
    /session.{0,40}(not found|does not exist|closed)|no (browser )?session|browser session.{0,20}(lost|closed)/i.test(
      diagnostic,
    )
  )
    return new ChatbridgeError(
      'Playwright CLI session is no longer available',
      'PLAYWRIGHT_CLI_SESSION_LOST',
    );
  return new ChatbridgeError('Playwright CLI operation failed', 'PLAYWRIGHT_CLI_FAILED');
}
