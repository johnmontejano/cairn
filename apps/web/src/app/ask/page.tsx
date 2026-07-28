import Link from 'next/link';
import { Badge, Callout, Card, Disclosure, EmptyState, Field, TextInput } from '@cairn/ui';
import { AppShell } from '@/components/chrome';
import { providerLabel } from '@/components/memory-card';
import { requireContext } from '@/server/context';
import { askQuestion } from '@/server/views';

export const metadata = { title: 'Ask' };
export const dynamic = 'force-dynamic';

/**
 * The Ask page.
 *
 * A GET form, so an answer has a shareable URL and the back button behaves.
 * Every sentence is followed by the citations it rests on, and "I do not have
 * enough saved about that" is shown as a normal outcome rather than an error.
 */
export default async function AskPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const context = await requireContext();
  const params = await searchParams;
  const question = (params.q ?? '').trim();
  const result = question.length > 0 ? await askQuestion(context, question) : null;

  return (
    <AppShell current="/ask" email={context.email}>
      <h1 className="cairn-page-title">Ask your memory</h1>
      <p className="cairn-page-lede">
        Answers come only from what you have saved here. If there is not enough to answer, it says
        so rather than guessing.
      </p>

      <Card>
        <form method="get" action="/ask" className="cairn-stack cairn-stack--md" role="search">
          <Field
            id="ask-q"
            label="Your question"
            hint="For example: what did we decide about the opening date?"
          >
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                name="q"
                defaultValue={question}
                aria-describedby={describedBy}
                autoFocus={question.length === 0}
                placeholder="What did we decide about…"
              />
            )}
          </Field>
          <div>
            <button type="submit" className="cairn-button cairn-button--primary">
              Ask
            </button>
          </div>
        </form>
      </Card>

      {result ? (
        <section style={{ marginTop: '2rem' }} aria-labelledby="answer-heading" aria-live="polite">
          <h2 id="answer-heading" className="cairn-section-title">
            Answer
          </h2>

          {result.answer.status === 'insufficient_evidence' ? (
            <Callout tone="info" title="Not enough saved about that yet">
              <p style={{ margin: '0 0 0.5rem' }}>{result.answer.note}</p>
              <Link href="/sources">Add something about it</Link>
            </Callout>
          ) : (
            <Card>
              <div className="cairn-answer">
                {result.answer.statements.map((statement, i) => (
                  <p key={i}>
                    {statement.text}
                    {statement.citationIndexes.map((index) => (
                      <a
                        key={index}
                        className="cairn-citation-marker"
                        href={`#citation-${index}`}
                        aria-label={`Source ${index + 1}`}
                      >
                        [{index + 1}]
                      </a>
                    ))}
                  </p>
                ))}
              </div>

              <Disclosure
                tone="accent"
                summary={`Why do you know this? (${result.answer.citations.length})`}
              >
                <ol style={{ paddingLeft: '1.25rem', margin: 0 }}>
                  {result.answer.citations.map((citation, index) => (
                    <li key={index} id={`citation-${index}`} style={{ marginBottom: '0.875rem' }}>
                      <div className="cairn-meta">
                        <strong>{citation.sourceItemTitle}</strong>
                        <span>{providerLabel(citation.sourceProvider)}</span>
                        <span>
                          characters {citation.startOffset}–{citation.endOffset}
                        </span>
                        <span>added {citation.importedAt.toISOString().slice(0, 10)}</span>
                      </div>
                      <blockquote className="cairn-excerpt">{citation.excerpt}</blockquote>
                      {citation.canonicalPath ? (
                        <p className="cairn-meta">
                          Saved in <code className="cairn-code">{citation.canonicalPath}</code>
                          {citation.memoryVersionId
                            ? ` · version ${citation.memoryVersionId.slice(0, 8)}`
                            : ''}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </Disclosure>

              <p className="cairn-meta" style={{ marginTop: '0.875rem' }}>
                <Badge tone="neutral">Answered using {result.usedModel}</Badge>
              </p>
            </Card>
          )}

          {result.passages.length > 0 ? (
            <section style={{ marginTop: '2rem' }} aria-labelledby="related">
              <h2 id="related" className="cairn-section-title">
                Related memory
              </h2>
              <div className="cairn-stack cairn-stack--sm">
                {result.passages.map((passage) => (
                  <Card key={passage.memoryItem.id}>
                    <h3 className="cairn-card__title">{passage.memoryItem.title}</h3>
                    <p className="cairn-memory-value">{passage.memoryItem.value}</p>
                    <p className="cairn-meta">
                      {passage.matchedBy.map((how) => (
                        <Badge key={how} tone="neutral">
                          {how === 'semantic' ? 'similar meaning' : 'exact words'}
                        </Badge>
                      ))}
                    </p>
                  </Card>
                ))}
              </div>
            </section>
          ) : null}
        </section>
      ) : (
        <div style={{ marginTop: '2rem' }}>
          <EmptyState title="Ask anything you have saved">
            Try “what did we decide?”, “what is left to do?”, or “who is doing what?”
          </EmptyState>
        </div>
      )}
    </AppShell>
  );
}
