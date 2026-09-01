import { describe, expect, it, vi } from 'vitest';
import { GitReviewHistoryVerifier } from '../../src/duet/review-history-verifier.js';

describe('GitReviewHistoryVerifier', () => {
  it('uses only merge-base ancestry and reports success', async () => {
    const run = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const verifier = new GitReviewHistoryVerifier({ run });
    expect(await verifier.isAncestor('a'.repeat(40), 'b'.repeat(40))).toBe(true);
    expect(run).toHaveBeenCalledWith([
      'merge-base',
      '--is-ancestor',
      'a'.repeat(40),
      'b'.repeat(40),
    ]);
  });

  it('reports divergence without performing another Git operation', async () => {
    const run = vi.fn(async () => {
      throw new Error('not ancestor');
    });
    const verifier = new GitReviewHistoryVerifier({ run });
    expect(await verifier.isAncestor('b'.repeat(40), 'c'.repeat(40))).toBe(false);
    expect(run).toHaveBeenCalledOnce();
  });
});
