import Link from 'next/link';
import { Card, CardHeader, EmptyState, Field, Select, Stack, TextArea, TextInput } from '@cairn/ui';
import { CANONICAL_DOCS, memoryTypes } from '@cairn/domain';
import { AppShell } from '@/components/chrome';
import { ActionForm, SubmitButton } from '@/components/forms';
import { MemoryCard, providerLabel } from '@/components/memory-card';
import { addMemoryManually, keepAllFromSource } from '@/server/actions';
import { csrfToken, requireContext } from '@/server/context';
import { loadMemoryPage, type MemoryCardView } from '@/server/views';

export const metadata = { title: 'Memory' };
export const dynamic = 'force-dynamic';

const FILTERS = [
  { key: 'all', label: 'Everything' },
  { key: 'proposed', label: 'Waiting for you' },
  { key: 'approved', label: 'Saved' },
  { key: 'conflicted', label: 'Disagreements' },
] as const;

interface SourceGroup {
  sourceItemId: string;
  label: string;
  provider: string | undefined;
  cards: MemoryCardView[];
}

/**
 * Clusters proposed, non-conflicted, ordinarily-sensitive cards by the source
 * item named in their first piece of evidence — one Gmail sync producing
 * several facts from the same message becomes one group instead of several
 * unrelated decisions.
 *
 * Deliberately narrow, per the redesign brief:
 * - Only `status === 'proposed'` cards are considered. Approved and
 *   conflicted-status cards (visible under the other filters) render exactly
 *   as they did before this change — never grouped, never bulk-acted-on.
 * - A card with an open conflict, or with sensitivity other than 'normal',
 *   is excluded from every group and always rendered with its normal
 *   individual Keep/Edit/Remove actions, same as today.
 * - A card whose evidence has no resolvable source item (no evidence, or the
 *   source record is missing) is left out of grouping rather than dropped
 *   into a catch-all "Other" bucket — it renders exactly as it did before.
 * - A source with only one eligible card is not worth a "keep all" shortcut,
 *   so groups of one are dissolved back into individual cards.
 */
function groupBySource(cards: MemoryCardView[]): Map<string, SourceGroup> {
  const groups = new Map<string, SourceGroup>();
  for (const card of cards) {
    if (card.item.status !== 'proposed') continue;
    if (card.conflict !== null) continue;
    if (card.item.sensitivity !== 'normal') continue;
    const sourceItemId = card.evidence[0]?.sourceItemId;
    if (!sourceItemId) continue;
    const source = card.sources.get(sourceItemId);
    if (!source) continue;

    const existing = groups.get(sourceItemId);
    if (existing) existing.cards.push(card);
    else
      groups.set(sourceItemId, {
        sourceItemId,
        label: source.title,
        provider: source.provider,
        cards: [card],
      });
  }
  for (const [key, group] of groups) {
    if (group.cards.length < 2) groups.delete(key);
  }
  return groups;
}

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

  // Walk the cards in their original order, folding every card that belongs
  // to a bulk-eligible source group into that group's single render slot (at
  // the position of the group's first member) instead of its own. Everything
  // else — solo cards, conflicted or sensitive proposals, approved/conflicted
  // items — renders individually, in the order it always has.
  const sourceGroups = groupBySource(cards);
  const renderedGroups = new Set<string>();
  const renderItems: Array<
    { kind: 'card'; card: MemoryCardView } | { kind: 'group'; group: SourceGroup }
  > = [];
  for (const card of cards) {
    const sourceItemId = card.evidence[0]?.sourceItemId;
    const group = sourceItemId ? sourceGroups.get(sourceItemId) : undefined;
    if (group) {
      if (renderedGroups.has(group.sourceItemId)) continue;
      renderedGroups.add(group.sourceItemId);
      renderItems.push({ kind: 'group', group });
    } else {
      renderItems.push({ kind: 'card', card });
    }
  }

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
        <div className="cairn-stack cairn-stack--md">
          {renderItems.map((entry) =>
            entry.kind === 'group' ? (
              <SourceGroupCard
                key={`source-${entry.group.sourceItemId}`}
                group={entry.group}
                csrf={csrf}
                projectId={context.project.id}
              />
            ) : (
              <MemoryCard
                key={entry.card.item.id}
                card={entry.card}
                csrf={csrf}
                projectId={context.project.id}
              />
            ),
          )}
        </div>
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

/**
 * A "keep all from this source" fast path alongside the ordinary per-item
 * review — not instead of it. Every card inside still has its own full
 * Keep/Edit/Remove controls (rendered by `MemoryCard` unchanged), so nothing
 * about reviewing one at a time is lost; this is only a shortcut for the
 * common case of trusting a whole batch from one place.
 */
function SourceGroupCard({
  group,
  csrf,
  projectId,
}: {
  group: SourceGroup;
  csrf: string;
  projectId: string;
}) {
  return (
    <Card>
      <CardHeader
        title={`${providerLabel(group.provider)} — ${group.label}`}
        description={`${group.cards.length} things found here are waiting for you. Keeping all of them is reversible — remove any of them below afterward, the same as any other memory.`}
        actions={
          <ActionForm
            action={keepAllFromSource}
            csrf={csrf}
            hidden={{
              projectId,
              memoryItemId: group.cards.map((c) => c.item.id),
            }}
          >
            <SubmitButton busyLabel="Keeping…">
              Keep all {group.cards.length} from this source
            </SubmitButton>
          </ActionForm>
        }
      />
      <Stack gap="sm">
        {group.cards.map((card) => (
          <MemoryCard key={card.item.id} card={card} csrf={csrf} projectId={projectId} />
        ))}
      </Stack>
    </Card>
  );
}
