import { Card, CardHeader, Stack } from '@cairn/ui';
import { ActionForm, SubmitButton } from '@/components/forms';
import { MemoryCard, providerLabel } from '@/components/memory-card';
import { keepAllFromSource, removeAllFromSource } from '@/server/actions';
import type { MemoryCardView } from '@/server/views';

/**
 * The review queue, grouped by where each memory came from.
 *
 * This used to live inside the Memory page, which meant the page a person
 * actually lands on after a first sync — Home — still rendered one card per
 * proposal. A single Gmail connection routinely produces dozens, so the first
 * thing the product asked of a new person was a few dozen individual decisions
 * before it became useful at all. The grouping was already built; it was simply
 * in the wrong place. It lives here now so every page that reviews proposals
 * gets the same behaviour.
 */

export interface SourceGroup {
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
 * Deliberately narrow:
 * - Only `status === 'proposed'` cards are considered. Approved and
 *   conflicted-status cards render exactly as they did before — never grouped,
 *   never bulk-acted-on.
 * - A card with an open conflict, or with sensitivity other than 'normal', is
 *   excluded from every group and always rendered with its normal individual
 *   Keep/Edit/Remove actions. Bulk-keeping something the product has flagged as
 *   contradictory or private is exactly the decision that should stay slow.
 * - A card whose evidence has no resolvable source item is left out of grouping
 *   rather than dropped into a catch-all bucket — it renders as it did before.
 * - A source with only one eligible card is not worth a "keep all" shortcut, so
 *   groups of one are dissolved back into individual cards.
 */
export function groupBySource(cards: MemoryCardView[]): Map<string, SourceGroup> {
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

/**
 * Walks the cards in their original order, folding every card that belongs to a
 * bulk-eligible group into that group's single render slot (at the position of
 * the group's first member) instead of its own. Everything else renders
 * individually, in the order it always has.
 */
export function ReviewQueue({
  cards,
  csrf,
  projectId,
}: {
  cards: MemoryCardView[];
  csrf: string;
  projectId: string;
}) {
  const sourceGroups = groupBySource(cards);
  const rendered = new Set<string>();
  const items: Array<
    { kind: 'card'; card: MemoryCardView } | { kind: 'group'; group: SourceGroup }
  > = [];

  for (const card of cards) {
    const sourceItemId = card.evidence[0]?.sourceItemId;
    const group = sourceItemId ? sourceGroups.get(sourceItemId) : undefined;
    if (group) {
      if (rendered.has(group.sourceItemId)) continue;
      rendered.add(group.sourceItemId);
      items.push({ kind: 'group', group });
    } else {
      items.push({ kind: 'card', card });
    }
  }

  return (
    <div className="cairn-stack cairn-stack--md">
      {items.map((entry) =>
        entry.kind === 'group' ? (
          <SourceGroupCard
            key={`group-${entry.group.sourceItemId}`}
            group={entry.group}
            csrf={csrf}
            projectId={projectId}
          />
        ) : (
          <MemoryCard
            key={entry.card.item.id}
            card={entry.card}
            csrf={csrf}
            projectId={projectId}
          />
        ),
      )}
    </div>
  );
}

/**
 * Fast paths for a whole batch from one place, alongside the ordinary per-item
 * review — not instead of it. Every card inside still has its own full
 * Keep/Edit/Remove controls (rendered by `MemoryCard` unchanged), so nothing
 * about reviewing one at a time is lost.
 *
 * Both directions are offered, because both are common and only one of them
 * was: a batch from a colleague's mail is usually worth keeping wholesale, and
 * a batch from a newsletter is usually worth turning down wholesale. Offering
 * only "keep all" left the second case as the slow one, which is backwards —
 * the junk is what there is most of.
 *
 * "Remove all" is deliberately the quieter of the two controls. It is
 * reversible (rejection soft-deletes, and History can put anything back), but
 * it should still read as the secondary choice rather than sitting level with
 * keeping.
 */
export function SourceGroupCard({
  group,
  csrf,
  projectId,
}: {
  group: SourceGroup;
  csrf: string;
  projectId: string;
}) {
  const memoryItemId = group.cards.map((c) => c.item.id);
  return (
    <Card>
      <CardHeader
        title={`${providerLabel(group.provider)} — ${group.label}`}
        description={`${group.cards.length} things found here are waiting for you. Either way is reversible — you can change any of them afterward, or from History.`}
        actions={
          <div className="cairn-row">
            <ActionForm action={keepAllFromSource} csrf={csrf} hidden={{ projectId, memoryItemId }}>
              <SubmitButton busyLabel="Keeping…">
                Keep all {group.cards.length} from this source
              </SubmitButton>
            </ActionForm>
            <ActionForm
              action={removeAllFromSource}
              csrf={csrf}
              hidden={{ projectId, memoryItemId }}
            >
              <SubmitButton tone="quiet" busyLabel="Removing…">
                Remove all {group.cards.length}
              </SubmitButton>
            </ActionForm>
          </div>
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
