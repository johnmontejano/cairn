import { describe, expect, it } from 'vitest';
import { IDENTITY_MAX_CHARS, assembleIdentity, missingIdentitySections } from '@cairn/search';
import type { IdentityInput } from '@cairn/search';

const item = (type: IdentityInput['type'], title: string, value: string): IdentityInput => ({
  type,
  title,
  value,
});

describe('assembleIdentity', () => {
  it('ships what exists rather than waiting to be complete', () => {
    const { markdown, present } = assembleIdentity([
      item('preference', 'Writing style', 'Plain words, short sentences.'),
    ]);

    expect(markdown).toContain('Plain words, short sentences.');
    expect(present).toEqual(['preference']);
    // The point of shipping incomplete: one section is still worth sending.
    expect(markdown.length).toBeGreaterThan(0);
  });

  it('says nothing at all when nothing is saved', () => {
    const { markdown, present } = assembleIdentity([]);
    expect(markdown).toBe('');
    expect(present).toEqual([]);
  });

  it('marks each section with the memory type it came from', () => {
    const { markdown } = assembleIdentity([
      item('decision', 'Deploy days', 'Never deploy on a Friday.'),
    ]);
    expect(markdown).toContain('<!-- cairn:decision -->');
    expect(markdown).toContain('<!-- /cairn:decision -->');
  });

  it('orders sections so what they work on comes before who they know', () => {
    const { markdown } = assembleIdentity([
      item('person_org', 'Priya', 'Runs operations.'),
      item('project_brief', 'Cairn', 'A shared memory for AI tools.'),
    ]);
    expect(markdown.indexOf('cairn:project_brief')).toBeLessThan(
      markdown.indexOf('cairn:person_org'),
    );
  });

  it('does not stutter when the title merely restates the value', () => {
    const { markdown } = assembleIdentity([
      item('preference', 'British spelling', 'British spelling throughout.'),
    ]);
    expect(markdown).toContain('- British spelling throughout.');
    expect(markdown).not.toContain('British spelling: British spelling throughout.');
  });

  it('does not stutter when the title is the value truncated with an ellipsis', () => {
    const { markdown } = assembleIdentity([
      item(
        'decision',
        'We decided to sign the Mill Street lease rather than the…',
        'We decided to sign the Mill Street lease rather than the unit by the station.',
      ),
    ]);
    expect(markdown).toContain(
      '- We decided to sign the Mill Street lease rather than the unit by the station.',
    );
    expect(markdown).not.toContain('the…: We decided');
  });

  it('stops at a section boundary rather than cutting mid-sentence', () => {
    const long = 'x'.repeat(400);
    const { markdown, truncated } = assembleIdentity([
      item('project_brief', 'A', long),
      item('operating_rule', 'B', long),
      item('preference', 'C', long),
      item('decision', 'D', long),
      item('person_org', 'E', long),
      item('current_state', 'F', long),
    ]);

    expect(truncated).toBe(true);
    expect(markdown.length).toBeLessThanOrEqual(IDENTITY_MAX_CHARS);
    // Every section that did survive is closed; none was cut halfway.
    const opened = markdown.match(/<!-- cairn:/g)?.length ?? 0;
    const closed = markdown.match(/<!-- \/cairn:/g)?.length ?? 0;
    expect(opened).toBe(closed);
  });

  it('reports which sections are still empty so a caller can ask for them', () => {
    const { present } = assembleIdentity([item('preference', 'Tone', 'Direct.')]);
    const missing = missingIdentitySections(present);

    expect(missing).toContain('project_brief');
    expect(missing).not.toContain('preference');
  });
});
