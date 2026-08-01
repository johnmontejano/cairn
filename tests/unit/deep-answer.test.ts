import { describe, expect, it } from 'vitest';
import {
  citedIndexes,
  danglingCitations,
  formatDeepAnswer,
  type DeepAnswerInput,
} from '@cairn/search';

const answer = (over: Partial<DeepAnswerInput> = {}): DeepAnswerInput => ({
  question: 'How do I make architectural decisions?',
  body: 'You choose reversible options [1] and write them down [2].',
  citations: [
    {
      memoryItemId: 'a',
      title: 'Option B chosen',
      sourceTitle: 'Planning notes',
      sourceProvider: 'notion',
    },
    {
      memoryItemId: 'b',
      title: 'Decisions are recorded',
      sourceTitle: 'Handbook',
      sourceProvider: 'google_drive',
    },
  ],
  unsupported: [],
  indexingPending: false,
  ...over,
});

describe('formatDeepAnswer', () => {
  it('numbers each source once so the body can refer back to it', () => {
    const out = formatDeepAnswer(answer());
    expect(out).toContain('1. Option B chosen — Planning notes (notion)');
    expect(out).toContain('2. Decisions are recorded — Handbook (google_drive)');
  });

  it('always writes the limits section, even when nothing is missing', () => {
    // Its absence would be ambiguous: a reader cannot tell "I checked and found
    // no gaps" from "I did not check".
    const out = formatDeepAnswer(answer({ unsupported: [] }));
    expect(out).toContain('## What the evidence does not support');
    expect(out).toContain('Nothing in the question went beyond what is saved.');
  });

  it('lists what the evidence could not answer', () => {
    const out = formatDeepAnswer(
      answer({ unsupported: ['Why you chose this cloud provider over another.'] }),
    );
    expect(out).toContain('- Why you chose this cloud provider over another.');
  });

  it('refuses rather than reaching when nothing bears on the question', () => {
    const out = formatDeepAnswer(answer({ citations: [], body: 'Probably you prefer X.' }));
    expect(out).not.toContain('Probably you prefer X.');
    expect(out).toContain('Nothing saved bears on this question');
  });

  it('says so when the answer was built mid-ingestion', () => {
    const out = formatDeepAnswer(answer({ indexingPending: true }));
    expect(out).toContain('still being read');
    expect(out).toContain('Asking again later may give a fuller answer.');
  });

  it('stays silent about indexing when nothing was pending', () => {
    expect(formatDeepAnswer(answer())).not.toContain('still being read');
  });
});

describe('citation markers', () => {
  it('finds each marker once, in order', () => {
    expect(citedIndexes('a [2] b [1] c [2]')).toEqual([1, 2]);
  });

  it('catches a marker pointing past the end of the list', () => {
    // A body citing [7] against a six-item list reads as authority while being
    // a bug, so the caller is given the means to catch it.
    expect(danglingCitations('grounded [1], invented [7]', 6)).toEqual([7]);
  });

  it('reports nothing when every marker resolves', () => {
    expect(danglingCitations('both [1] and [2]', 2)).toEqual([]);
  });
});
