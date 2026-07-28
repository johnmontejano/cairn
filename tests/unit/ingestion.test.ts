import { describe, expect, it } from 'vitest';
import { EXAMPLE_DOCUMENT } from '@cairn/connectors';
import {
  CueMemoryExtractor,
  canonicalizeText,
  chunkText,
  claimKey,
  findContradiction,
  guessMime,
  htmlToText,
  jaccard,
  normalizeSource,
  splitIntoSpans,
  verifyEvidence,
} from '@cairn/ingestion';
import type { MemoryItem } from '@cairn/domain';

describe('normalization', () => {
  it('is deterministic, so offsets stored today still point at the right words tomorrow', async () => {
    const bytes = new TextEncoder().encode('Line one\r\nLine two\r\n\r\n\r\n\r\nLine three  \n');
    const a = await normalizeSource({ bytes, mimeType: 'text/plain' });
    const b = await normalizeSource({ bytes, mimeType: 'text/plain' });
    expect(a.text).toBe(b.text);
    expect(a.text).toBe('Line one\nLine two\n\n\nLine three');
  });

  it('collapses non-breaking spaces and strips zero-width characters', () => {
    expect(canonicalizeText('a b​c')).toBe('a bc'.replace('c', 'c'));
    expect(canonicalizeText('a b')).toBe('a b');
  });

  it('reads HTML as text without markup', () => {
    const text = htmlToText(
      '<html><head><style>p{}</style></head><body><h1>Title</h1><p>First&nbsp;line.</p><script>evil()</script><p>Second</p></body></html>',
    );
    expect(text).toContain('Title');
    expect(text).toContain('First line.');
    expect(text).toContain('Second');
    expect(text).not.toContain('evil');
    expect(text).not.toContain('<p>');
  });

  it('refuses a file type it cannot read rather than storing noise', async () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 0, 255, 0, 12, 7, 0]);
    await expect(normalizeSource({ bytes, mimeType: 'application/x-binary' })).rejects.toThrow(
      /unsupported file type/i,
    );
  });

  it('maps common extensions to types', () => {
    expect(guessMime('notes.md')).toBe('text/markdown');
    expect(guessMime('report.PDF')).toBe('application/pdf');
    expect(guessMime('letter.docx')).toContain('wordprocessingml');
    expect(guessMime('mystery.zzz')).toBe('application/octet-stream');
  });
});

describe('chunking and spans', () => {
  it('produces chunks whose offsets slice back to their own text', () => {
    const chunks = chunkText(EXAMPLE_DOCUMENT);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(EXAMPLE_DOCUMENT.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.text);
    }
  });

  it('keeps chunks within the size ceiling', () => {
    const long = 'word '.repeat(4000);
    for (const chunk of chunkText(long, { targetChars: 500, maxChars: 800 })) {
      expect(chunk.text.length).toBeLessThanOrEqual(800);
    }
  });

  it('labels chunks with the heading they sit under', () => {
    const chunks = chunkText(EXAMPLE_DOCUMENT);
    expect(chunks.some((c) => c.heading === 'What we decided')).toBe(true);
  });

  it('splits sentences and bullets with accurate offsets', () => {
    const spans = splitIntoSpans(EXAMPLE_DOCUMENT);
    expect(spans.length).toBeGreaterThan(10);
    for (const span of spans) {
      // Offsets index the original text exactly. The span's own text has hard
      // line breaks flattened to spaces, which is what makes a wrapped sentence
      // one memory instead of two fragments.
      expect(EXAMPLE_DOCUMENT.slice(span.startOffset, span.endOffset).replace(/\n/g, ' ')).toBe(
        span.text,
      );
    }
  });

  it('keeps a sentence whole when the source wrapped it across lines', () => {
    const wrapped =
      '# Notes\n\nPriya was firm that trying to launch\ntwelve products would mean doing all\nof them badly.\n';
    const spans = splitIntoSpans(wrapped);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.text).toBe(
      'Priya was firm that trying to launch twelve products would mean doing all of them badly.',
    );
    expect(wrapped.slice(spans[0]!.startOffset, spans[0]!.endOffset).replace(/\n/g, ' ')).toBe(
      spans[0]!.text,
    );
  });
});

describe('the built-in extractor', () => {
  const extractor = new CueMemoryExtractor();
  const request = {
    text: EXAMPLE_DOCUMENT,
    sourceTitle: 'Planning notes',
    provider: 'paste' as const,
    projectName: 'Bakery',
    contentHash: 'sha256:test',
  };

  it('is deterministic', async () => {
    const a = await extractor.extract(request);
    const b = await extractor.extract(request);
    expect(a.candidates.map((c) => c.value)).toEqual(b.candidates.map((c) => c.value));
  });

  it('gives every candidate evidence that really exists in the document', async () => {
    const { candidates } = await extractor.extract(request);
    expect(candidates.length).toBeGreaterThan(5);
    for (const candidate of candidates) {
      expect(candidate.evidence.length).toBeGreaterThan(0);
      for (const evidence of candidate.evidence) {
        expect(EXAMPLE_DOCUMENT.slice(evidence.startOffset, evidence.endOffset)).toBe(
          evidence.excerpt,
        );
      }
    }
  });

  it('recognises decisions, next steps, and rules from how people actually write', async () => {
    const { candidates } = await extractor.extract(request);
    const types = new Set(candidates.map((c) => c.type));
    expect(types.has('decision')).toBe(true);
    expect(types.has('next_step')).toBe(true);
    expect(types.has('operating_rule')).toBe(true);
  });

  it('records which model and prompt produced the result', async () => {
    const { usage } = await extractor.extract(request);
    expect(usage.model).toBe('built-in-cue-extractor-v1');
    expect(usage.promptVersion).toBeTruthy();
    expect(usage.schemaVersion).toBeTruthy();
    expect(usage.estimatedCostUsd).toBe(0);
  });

  it('marks money and health material as sensitive', async () => {
    const { candidates } = await extractor.extract({
      ...request,
      text: '# Notes\n\nWe decided the salary for the new baker is confidential and must not be shared.\n',
    });
    expect(candidates.some((c) => c.sensitivity === 'sensitive')).toBe(true);
  });
});

describe('model output is treated as untrusted', () => {
  const document = 'The opening date is 4 September. The oven arrives in July.';

  it('keeps a candidate whose quoted evidence exists, correcting its offsets', () => {
    const kept = verifyEvidence(
      [
        {
          type: 'decision',
          title: 'Opening date',
          value: 'Opening on 4 September',
          topics: [],
          sensitivity: 'normal',
          confidence: 0.9,
          observedAt: null,
          evidence: [
            { startOffset: 999, endOffset: 1200, excerpt: 'The opening date is 4 September.' },
          ],
        },
      ],
      document,
    );
    expect(kept).toHaveLength(1);
    expect(document.slice(kept[0]!.evidence[0]!.startOffset, kept[0]!.evidence[0]!.endOffset)).toBe(
      'The opening date is 4 September.',
    );
  });

  it('discards a candidate whose evidence is not in the document at all', () => {
    const kept = verifyEvidence(
      [
        {
          type: 'fact',
          title: 'Invented',
          value: 'The bakery has three floors',
          topics: [],
          sensitivity: 'normal',
          confidence: 0.9,
          observedAt: null,
          evidence: [{ startOffset: 0, endOffset: 20, excerpt: 'The bakery has three floors' }],
        },
      ],
      document,
    );
    expect(kept).toHaveLength(0);
  });
});

describe('contradiction detection', () => {
  function item(value: string, extra: Partial<MemoryItem> = {}): MemoryItem {
    return {
      id: `id-${value.length}-${extra.status ?? 'approved'}`,
      workspaceId: 'ws',
      projectId: 'p',
      type: 'decision',
      status: 'approved',
      value,
      normalizedValue: value.toLowerCase(),
      title: value.slice(0, 20),
      topics: [],
      sensitivity: 'normal',
      visibility: 'share_with_authorized_clients',
      observedAt: null,
      importedAt: new Date(),
      validFrom: null,
      validTo: null,
      supersedesId: null,
      supersededById: null,
      conflictGroupId: null,
      extractionMethod: 'ai_extraction',
      extractionModel: null,
      extractionPromptVersion: null,
      extractionSchemaVersion: null,
      confidence: 0.8,
      canonicalPath: null,
      canonicalVersionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...extra,
    };
  }

  it('ignores the numbers when deciding what a claim is about', () => {
    const a = claimKey('We agreed the opening date is 4 September');
    const b = claimKey('We agreed the opening date is 18 September');
    expect(jaccard(a, b)).toBe(1);
  });

  it('flags two statements about the same subject that differ', () => {
    const found = findContradiction(
      { type: 'decision', value: 'We agreed the opening date is 18 September' },
      [item('We agreed the opening date is 4 September')],
    );
    expect(found).not.toBeNull();
  });

  it('does not flag statements about different subjects', () => {
    expect(
      findContradiction({ type: 'decision', value: 'We decided to buy a second oven' }, [
        item('We agreed the opening date is 4 September'),
      ]),
    ).toBeNull();
  });

  it('does not compare against memory that is not approved', () => {
    expect(
      findContradiction({ type: 'decision', value: 'We agreed the opening date is 18 September' }, [
        item('We agreed the opening date is 4 September', { status: 'proposed' }),
      ]),
    ).toBeNull();
  });

  it('treats a second project brief as a contradiction by definition', () => {
    const found = findContradiction({ type: 'project_brief', value: 'A cafe in the town centre' }, [
      item('A bakery on Mill Street', { type: 'project_brief' }),
    ]);
    expect(found?.reason).toMatch(/already a saved project brief/i);
  });
});
