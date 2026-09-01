import { describe, expect, it } from 'vitest';
import { OriginPolicy } from '../../src/browser/origin-policy.js';
describe('origin policy', () => {
  const policy = new OriginPolicy(['https://chatgpt.com']);
  it('allows the configured ChatGPT origin and its paths', () =>
    expect(policy.allows('https://chatgpt.com/c/123')).toBe(true));
  it('rejects lookalike and unrelated origins', () => {
    expect(policy.allows('https://chatgpt.com.evil.test/')).toBe(false);
    expect(() => policy.assertAllowed('https://example.com')).toThrow(/not allowlisted/);
  });
});
