import { Badge, Card, Disclosure } from '@cairn/ui';
import { CANONICAL_DOCS } from '@cairn/domain';
import { editMemory, keepMemory, removeMemory, resolveMemoryConflict } from '@/server/actions';
import { MemoryReviewActions, ActionForm, SubmitButton } from './forms';
import type { MemoryCardView } from '@/server/views';

/**
 * One memory, as a person sees it.
 *
 * The evidence is always one click away and never hidden behind a separate
 * screen, because "why do you know this?" is the question that decides whether
 * someone trusts any of this.
 */
export function MemoryCard({
  card,
  csrf,
  projectId,
  showStatus = true,
}: {
  card: MemoryCardView;
  csrf: string;
  projectId: string;
  showStatus?: boolean;
}) {
  const { item, evidence, sources } = card;
  const kind = CANONICAL_DOCS[item.type].title;

  return (
    <Card>
      <div className="cairn-card__header">
        <div>
          <h3 className="cairn-card__title">{item.title}</h3>
          <div className="cairn-meta" style={{ marginTop: '0.25rem' }}>
            <Badge tone="neutral">{kind}</Badge>
            {showStatus ? <StatusBadge status={item.status} /> : null}
            {item.sensitivity !== 'normal' ? <Badge tone="warn">Sensitive</Badge> : null}
            {item.visibility === 'never_share' ? <Badge tone="info">Never shared</Badge> : null}
            {item.visibility === 'website_only' ? (
              <Badge tone="info">Not sent to AI tools</Badge>
            ) : null}
          </div>
        </div>
      </div>

      <p className="cairn-memory-value">{item.value}</p>

      {card.conflict ? (
        <div style={{ marginBottom: '0.875rem' }}>
          <div className="cairn-callout cairn-callout--warn">
            <p className="cairn-callout__title">These do not agree</p>
            <div className="cairn-callout__body">
              <p style={{ margin: '0 0 0.5rem' }}>{card.conflict.reason}</p>
              <p style={{ margin: '0 0 0.5rem' }}>
                Both versions are kept. Choose the one that is right — the other stays in your
                history.
              </p>
              <ActionForm
                action={resolveMemoryConflict}
                csrf={csrf}
                hidden={{
                  projectId,
                  conflictId: card.conflict.id,
                  keepMemoryItemId: item.id,
                }}
              >
                <SubmitButton busyLabel="Saving…">Keep this one</SubmitButton>
              </ActionForm>
            </div>
          </div>
        </div>
      ) : null}

      <Disclosure
        tone="accent"
        summary={`Why do you know this? (${evidence.length} source${evidence.length === 1 ? '' : 's'})`}
      >
        {evidence.length === 0 ? (
          <p>
            No source is attached, so this cannot be kept. That is deliberate: nothing is saved
            without something to point back to.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {evidence.map((e) => {
              const source = sources.get(e.sourceItemId);
              return (
                <li key={e.id} style={{ marginBottom: '0.875rem' }}>
                  <div className="cairn-meta">
                    <strong>{source?.title ?? 'Unknown source'}</strong>
                    <span>{providerLabel(source?.provider)}</span>
                    <span>
                      characters {e.startOffset}–{e.endOffset}
                    </span>
                    <span>added {e.createdAt.toISOString().slice(0, 10)}</span>
                  </div>
                  <blockquote className="cairn-excerpt">{e.excerpt}</blockquote>
                  {source?.canonicalUri ? (
                    <a
                      href={source.canonicalUri}
                      rel="noreferrer noopener nofollow"
                      target="_blank"
                    >
                      Open the original
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {item.canonicalPath ? (
          <p className="cairn-meta" style={{ marginTop: '0.5rem' }}>
            Saved in <code className="cairn-code">{item.canonicalPath}</code>
            {item.canonicalVersionId ? ` · version ${item.canonicalVersionId.slice(0, 8)}` : ''}
          </p>
        ) : null}
      </Disclosure>

      <div style={{ marginTop: '0.875rem' }}>
        <MemoryReviewActions
          csrf={csrf}
          projectId={projectId}
          memoryItemId={item.id}
          keepAction={keepMemory}
          removeAction={removeMemory}
          editAction={editMemory}
          title={item.title}
          value={item.value}
          sensitivity={item.sensitivity}
          visibility={item.visibility}
          approved={item.status === 'approved'}
        />
      </div>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'approved') return <Badge tone="good">Saved</Badge>;
  if (status === 'proposed') return <Badge tone="accent">Waiting for you</Badge>;
  if (status === 'conflicted') return <Badge tone="warn">Needs a decision</Badge>;
  if (status === 'superseded') return <Badge tone="neutral">Replaced</Badge>;
  return <Badge tone="neutral">{status}</Badge>;
}

export function providerLabel(provider: string | undefined): string {
  switch (provider) {
    case 'paste':
      return 'pasted';
    case 'upload':
      return 'uploaded file';
    case 'url':
      return 'web page';
    case 'google_drive':
      return 'Google Drive';
    case 'github':
      return 'GitHub';
    case 'gmail':
      return 'Gmail';
    case 'google_calendar':
      return 'Google Calendar';
    case 'notion':
      return 'Notion';
    default:
      return 'source';
  }
}
