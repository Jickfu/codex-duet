import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ChatbridgeError } from '../core/errors.js';
import { LOCAL_LIMITS } from './limits.js';

const execute = promisify(execFile);

export function localGitEnvironment(): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
  );
  return { ...env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
}

export async function readLocalGit(
  root: string,
  args: string[],
  options: { diff?: boolean; acceptDifference?: boolean } = {},
): Promise<string> {
  let stdout: Buffer;
  try {
    const result = await execute(
      'git',
      [
        '--no-pager',
        '--literal-pathspecs',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'diff.external=',
        '-c',
        'core.quotePath=false',
        ...args,
      ],
      {
        cwd: root,
        encoding: 'buffer',
        maxBuffer: options.diff
          ? LOCAL_LIMITS.materializedDiffBytes
          : LOCAL_LIMITS.gitEnumerationBytes,
        env: localGitEnvironment(),
      },
    );
    stdout = result.stdout;
  } catch (error: any) {
    if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
      throw new ChatbridgeError('Git output exceeds the hard limit', 'SNAPSHOT_LIMIT_EXCEEDED');
    if (options.acceptDifference && error?.code === 1 && Buffer.isBuffer(error.stdout))
      stdout = error.stdout;
    else throw error;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(stdout);
  } catch {
    throw new ChatbridgeError('Git output is not UTF-8', 'LOCAL_GIT_ENCODING_UNSUPPORTED');
  }
}
