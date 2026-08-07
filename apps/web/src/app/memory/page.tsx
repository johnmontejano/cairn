import Link from 'next/link';
import { Card, EmptyState, Field, Select, TextArea, TextInput } from '@cairn/ui';
import { CANONICAL_DOCS, memoryTypes } from '@cairn/domain';
import { AppShell } from '@/components/chrome';
import { ActionForm, SubmitButton } from '@/components/forms';
import { ReviewQueue } from '@/components/review-queue';
import { addMemoryManually, removeAllWaiting } from '@/server/actions';
import { csrfToken, requireContext } from '@/server/context';
import { loadMemoryPage } from '@/server/views';

export const metadata = { title: 'Memory' };
export const dynamic = 'force-dynamic';

const FILTERS = [
  { key: 'all', label: 'Everything' },
  { key: 'proposed', label: 'Waiting for you' },
  { key: 'approved', label: 'Saved' },
  { key: 'conflicted', label: 'Disagreements' },
] as const;

export default async function MemoryPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const context = await requireContext();
  const csrf = await csrfToken();
  const params = await searchParams;
  const filter = (FILTERS.find((f) => f.key === params.filter)?.key ?? 'all') as
    'all' | 'proposed' | 'approved' | 'conflicted';
  const { cards, counts } = await loadMemoryPage(context, filter);

  return (
    <AppShell current="/memory" email={context.email}>
      <h1 className="cairn-page-title">Memory</h1>
      <p className="cairn-page-lede">
        Everything here is yours to change. Saved memory is what an AI tool can look up; anything
        still waiting for you is not shared with anything.
      </p>

      <nav aria-label="Filter memory" className="cairn-row" style={{ marginBottom: '1.5rem' }}>
        {FILTERS.map((option) => (
          <Link
            key={option.key}
            href={`/memory?filter=${option.key}`}
            className="cairn-nav__link"
            aria-current={filter === option.key ? 'page' : undefined}
          >
            {option.label} ({counts[option.key] ?? 0})
          </Link>
        ))}
      </nav>

      {/* Only on the waiting list, and only when there is a backlog worth the
          word "all". Per-source removal stays the normal way to turn something
          down; this exists for the case that per-source removal cannot
          reasonably serve — a first sync that left more sources than anyone
          will click through. */}
      {filter === 'proposed' && (counts.proposed ?? 0) > 0 ? (
        <ActionForm
          action={removeAllWaiting}
          csrf={csrf}
          hidden={{ projectId: context.project.id }}
          successTone="info"
        >
          <p className="cairn-card__description" style={{ marginTop: 0 }}>
            Cleared in one step, and reversible from History. Saved memory and disagreements are
            left alone.
          </p>
          <SubmitButton tone="secondary" busyLabel="Removing…">
            Remove all {counts.proposed} waiting
          </SubmitButton>
        </ActionForm>
      ) : null}

      {cards.length === 0 ? (
        <EmptyState
          title="Nothing here"
          action={
            <Link href="/sources" className="cairn-button cairn-button--primary">
              Add something
            </Link>
          }
        >
          {filter === 'conflicted'
            ? 'No disagreements. When two notes contradict each other, both are kept and you choose.'
            : 'Add a note or a document and anything worth remembering will show up here.'}
        </EmptyState>
      ) : (
        <ReviewQueue cards={cards} csrf={csrf} projectId={context.project.id} />
      )}

      <section style={{ marginTop: '2.5rem' }} aria-labelledby="write-one">
        <h2 id="write-one" className="cairn-section-title">
          Write one yourself
        </h2>
        <Card>
          <p className="cairn-card__description" style={{ marginTop: 0 }}>
            What you write is kept as its own note, so this memory has a source to point back to
            just like the rest.
          </p>
          <ActionForm
            action={addMemoryManually}
            csrf={csrf}
            hidden={{ projectId: context.project.id }}
            className="cairn-stack cairn-stack--md"
          >
            <Field id="manual-type" label="What kind of thing is this?">
              {({ id }) => (
                <Select id={id} name="type" defaultValue="fact">
                  {memoryTypes.map((type) => (
                    <option key={type} value={type}>
                      {CANONICAL_DOCS[type].title}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="manual-title" label="Short name" required>
              {({ id }) => (
                <TextInput
                  id={id}
                  name="title"
                  required
                  maxLength={200}
                  placeholder="Opening date"
                />
              )}
            </Field>
            <Field id="manual-value" label="What should be remembered?" required>
              {({ id }) => <TextArea id={id} name="value" required rows={4} />}
            </Field>
            <div>
              <SubmitButton busyLabel="Saving…">Add to my review list</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </section>
    </AppShell>
  );
}
