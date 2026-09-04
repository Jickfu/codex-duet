import { describe, expect, it } from 'vitest';
import { installationReadiness } from '../../src/cli/readiness.js';

describe('offline installation readiness', () => {
  it('reports installation readiness without implying Browser or task readiness', async () => {
    const result = await installationReadiness({
      nodeVersion: '20.1.0',
      git: async () => 'git version 2.50.1.windows.1',
      artifact: async () => {},
    });
    expect(result.ready).toBe(true);
    expect(result.scope).toContain('task state are not checked');
  });
  it('reports all missing prerequisites and does not echo process errors', async () => {
    const result = await installationReadiness({
      nodeVersion: '18.0.0',
      git: async () => {
        throw new Error('secret diagnostic');
      },
      artifact: async () => {
        throw new Error('private path');
      },
    });
    expect(result.ready).toBe(false);
    expect(result.checks.every((c) => c.status === 'FAIL')).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/secret diagnostic|private path/);
  });
  it('does not treat arbitrary executable output as a valid Git version', async () => {
    const result = await installationReadiness({
      nodeVersion: '24.0.0',
      git: async () => 'not git',
      artifact: async () => {},
    });
    expect(result.checks.find((c) => c.name === 'git')?.status).toBe('FAIL');
  });
});
