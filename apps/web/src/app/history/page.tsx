import Link from 'next/link';
import { Badge, Card, Disclosure, EmptyState } from '@cairn/ui';
import { AppShell } from '@/components/chrome';
import { csrfToken, requireContext } from '@/server/context';
import { loadHistory, loadVersionDocuments } from '@/server/views';

export const metadata = { title: 'History' };
export const dynamic = 'force-dynamic';

const ACTION_LABELS: Record<string, string> = {
  'auth.sign_in': 'You signed in',
  'source.connected': 'You connected an app',
  'source.disconnected': 'You disconnected an app',
  'source.ingested': 'A document was read',
  'memory.proposed': 'New things were found to review',
  'memory.approved': 'You kept a memory',
  'memory.edited': 'You changed a memory',
  'memory.rejected': 'You removed a memory',
  'memory.conflict_resolved': 'You settled a disagreement',
  'export.created': 'You downloaded your memory',
  'backup.created': 'You made a backup',
  'restore.performed': 'You restored from a backup',
  'mcp.retrieved': 'A connected AI looked something up',
  'mcp.proposed': 'A connected AI suggested something',
  'mcp.client_created': 'You connected an AI tool',
  'mcp.client_revoked': 'You turned off an AI tool',
  'workspace.deleted': 'Everything was deleted',
};

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ version?: string }>;
}) {
  const context = await requireContext();
  const csrf = await csrfToken();
  const view = await loadHistory(context);
  const params = await searchParams;
  const viewing = params.version ? await loadVersionDocuments(context, params.version) : null;

  return (
    <AppShell current="/history" email={context.email}>
      <h1 className="cairn-page-title">History</h1>
      <p className="cairn-page-lede">
        Every change to your memory is kept. Nothing is overwritten, so you can always see what it
        used to say.
      </p>

      {viewing?.version ? (
        <section aria-labelledby="viewing" style={{ marginBottom: '2.5rem' }}>
          <h2 id="viewing" className="cairn-section-title">
            Version from {viewing.version.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
          </h2>
          <Card>
            <p className="cairn-meta">
              {viewing.version.reason} · {viewing.version.authorLabel} · fingerprint{' '}
              <code className="cairn-code">{viewing.version.manifestHash.slice(7, 19)}</code>
            </p>
            {viewing.files.map((file) => (
              <Disclosure key={file.path} summary={file.path}>
                <pre className="cairn-code">{file.content}</pre>
              </Disclosure>
            ))}
            <div style={{ marginTop: '0.875rem' }}>
              <Link href="/history" className="cairn-button cairn-button--quiet">
                Close
              </Link>
            </div>
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="versions" style={{ marginBottom: '2.5rem' }}>
        <h2 id="versions" className="cairn-section-title">
          Versions of your memory ({view.versions.length})
        </h2>
        {view.versions.length === 0 ? (
          <EmptyState title="No versions yet">
            A version is written every time you keep or change something.
          </EmptyState>
        ) : (
          <div className="cairn-table-wrap">
            <table className="cairn-table">
              <caption className="cairn-visually-hidden">Saved versions</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">What changed</th>
                  <th scope="col">Who</th>
                  <th scope="col">Fingerprint</th>
                  <th scope="col">
                    <span className="cairn-visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.versions.map((version) => (
                  <tr key={version.id}>
                    <th scope="row" style={{ fontWeight: 550 }}>
                      {version.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                    </th>
                    <td>{version.reason}</td>
                    <td>{version.authorLabel}</td>
                    <td>
                      <code className="cairn-code">{version.manifestHash.slice(7, 19)}</code>
                    </td>
                    <td>
                      <Link href={`/history?version=${version.id}`}>Look at it</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="removed" style={{ marginBottom: '2.5rem' }}>
        <h2 id="removed" className="cairn-section-title">
          Removed memory ({view.removed.length})
        </h2>
        {view.removed.length === 0 ? (
          <EmptyState title="Nothing removed" />
        ) : (
          <div className="cairn-stack cairn-stack--sm">
            {view.removed.map((item) => (
              <Card key={item.id}>
                <div className="cairn-card__header">
                  <div>
                    <h3 className="cairn-card__title">{item.title}</h3>
                    <p className="cairn-card__description">{item.value}</p>
                  </div>
                  <form method="post" action="/api/memory/undo">
                    <input type="hidden" name="csrf" value={csrf} />
                    <input type="hidden" name="memoryItemId" value={item.id} />
                    <input type="hidden" name="returnTo" value="/history" />
                    <button type="submit" className="cairn-button cairn-button--secondary">
                      Undo
                    </button>
                  </form>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="activity">
        <h2 id="activity" className="cairn-section-title">
          Everything that happened
        </h2>
        <div className="cairn-table-wrap">
          <table className="cairn-table">
            <caption className="cairn-visually-hidden">Activity log</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">What</th>
                <th scope="col">Who</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {view.events.map((event) => (
                <tr key={event.id}>
                  <th scope="row" style={{ fontWeight: 550 }}>
                    {event.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                  </th>
                  <td>{ACTION_LABELS[event.action] ?? event.action}</td>
                  <td>
                    {event.actorClientId ? (
                      <Badge tone="info">A connected AI</Badge>
                    ) : (
                      <Badge tone="neutral">You</Badge>
                    )}
                  </td>
                  <td>{describe(event.action, event.metadata)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}

/**
 * Says what happened in ordinary words.
 *
 * The audit record holds machine metadata; printing it raw put developer output
 * in front of people who did not ask for it. Anything without a phrasing shows
 * nothing rather than something meaningless.
 */
function describe(action: string, metadata: Record<string, unknown>): string {
  const number = (key: string): number | null => {
    const value = metadata[key];
    return typeof value === 'number' ? value : null;
  };

  switch (action) {
    case 'source.ingested': {
      const bytes = number('bytes');
      return bytes === null ? '' : `${Math.max(1, Math.round(bytes / 1024))} KB read`;
    }
    case 'memory.proposed': {
      const proposed = number('proposed') ?? 0;
      const conflicts = number('conflicts') ?? 0;
      const parts = [`${proposed} to review`];
      if (conflicts > 0) parts.push(`${conflicts} disagreement${conflicts === 1 ? '' : 's'}`);
      return parts.join(', ');
    }
    case 'mcp.retrieved': {
      const results = number('results');
      return results === null
        ? 'looked something up'
        : `${results} result${results === 1 ? '' : 's'}`;
    }
    case 'export.created': {
      const items = number('itemCount');
      return items === null ? '' : `${items} memories`;
    }
    case 'restore.performed': {
      const items = number('memoryItems');
      return items === null ? '' : `${items} memories restored`;
    }
    default:
      return '';
  }
}
