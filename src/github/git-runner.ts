import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ChatbridgeError } from '../core/errors.js';

const execFileAsync = promisify(execFile);

export type GitResult = { stdout: string; stderr: string };
export type GitExecutor = (
  file: string,
  args: readonly string[],
  options: { cwd: string; timeout: number; maxBuffer: number; windowsHide: boolean },
) => Promise<{ stdout: string; stderr: string }>;

export class GitRunner {
  constructor(
    readonly cwd: string,
    private readonly timeout = 30_000,
    private readonly maxBuffer = 1024 * 1024,
    private readonly executor: GitExecutor = execFileAsync as GitExecutor,
  ) {}

  async run(args: readonly string[]): Promise<GitResult> {
    try {
      const result = await this.executor('git', args, {
        cwd: this.cwd,
        timeout: this.timeout,
        maxBuffer: this.maxBuffer,
        windowsHide: true,
      });
      return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
    } catch (error: any) {
      const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
      const code = typeof error?.code === 'number' ? error.code : undefined;
      throw new ChatbridgeError(
        `git ${args[0] ?? 'command'} failed${code === undefined ? '' : ` (exit ${code})`}${
          stderr ? `: ${sanitize(stderr)}` : ''
        }`,
        'GIT_COMMAND_FAILED',
      );
    }
  }
}

function sanitize(value: string): string {
  return value
    .replace(/(https?:\/\/)[^/@\s]+@/g, '$1[redacted]@')
    .replace(/(token|password|authorization)=\S+/gi, '$1=[redacted]')
    .slice(0, 2_000);
}
