import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('codex-duet Skill', () => {
  it('has valid minimal frontmatter and explicit side-effect invocation policy', async () => {
    const skill = await readFile(
      path.join(process.cwd(), '.agents', 'skills', 'codex-duet', 'SKILL.md'),
      'utf8',
    );
    expect(skill).toMatch(/^---\r?\nname: codex-duet\r?\ndescription: .+\r?\n---/);
    expect(skill).toContain('explicitly');
    expect(skill).toContain('ordinary coding requests');
  });
  it('preserves frozen boundaries without SDK or direct push instructions', async () => {
    const root = path.join(process.cwd(), '.agents', 'skills', 'codex-duet');
    const text = `${await readFile(path.join(root, 'SKILL.md'), 'utf8')}\n${await readFile(path.join(root, 'references', 'workflow.md'), 'utf8')}`;
    expect(text).toContain('GitHubCodeProvider');
    expect(text).toContain('Do not push');
    expect(text).toContain('Never inspect ChatGPT DOM/selectors');
    expect(text).toContain('Never bypass');
    expect(text).toContain('chatbridge wait --task <taskId> --parse');
    expect(text).toContain('chatbridge send --task <taskId>');
    expect(text).toContain('validated Envelope JSON');
    expect(text).toContain('Raw C2C');
    expect(text).toContain('automatically');
    expect(text).toContain('does not need to say "continue"');
    expect(text).toContain('ITERATION_LIMIT_REACHED');
    expect(text).toContain('BLOCKED');
    expect(text).toContain('duet reconcile-execution --task <taskId>');
    expect(text).toContain('duet record-tests --task <taskId>');
    expect(text).toContain('never blindly replay');
    expect(text).toContain('PREVIOUS_REVIEW_REF..REVIEW_REF');
    expect(text).not.toContain('@openai/codex-sdk');
  });
});
