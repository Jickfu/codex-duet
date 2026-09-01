import { describe, expect, expectTypeOf, it } from 'vitest';
import { TaskIdSchema, TestStatusSchema } from '../../src/core/domain.js';
import { githubReviewEnvelope } from '../../src/github/review-envelope.js';
import type {
  GitHubContextRef,
  GitHubReviewTarget,
  LocalContextRef,
} from '../../src/providers/code-provider.js';
import { GitHubCodeProvider } from '../../src/github/github-code-provider.js';

describe('provider boundary', () => {
  it('keeps task ID and test status independent of GitHub modules', () => {
    expect(TaskIdSchema.parse('shared_1')).toBe('shared_1');
    expect(TestStatusSchema.options).toEqual(['PASS', 'FAIL', 'NOT_RUN']);
  });

  it('models GitHub and Local contexts as discriminated types', () => {
    expectTypeOf<
      Awaited<ReturnType<GitHubCodeProvider['prepareContext']>>
    >().toEqualTypeOf<GitHubContextRef>();
    expectTypeOf<
      Awaited<ReturnType<GitHubCodeProvider['getReviewTarget']>>
    >().toEqualTypeOf<GitHubReviewTarget>();
    expectTypeOf<Parameters<typeof githubReviewEnvelope>[0]>().toEqualTypeOf<GitHubReviewTarget>();
    expectTypeOf<LocalContextRef>().not.toMatchTypeOf<Parameters<typeof githubReviewEnvelope>[0]>();
    const local: LocalContextRef = { mode: 'LOCAL', taskId: 'local' };
    expect(local.mode).toBe('LOCAL');
  });
});
