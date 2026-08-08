import Link from 'next/link';
import { CONNECTOR_DESCRIPTIONS } from '@cairn/connectors';
import { RECOMMENDED_CONNECTED_APPS, type SourceProvider } from '@cairn/domain';
import { Badge, Callout, Card, Disclosure, EmptyState } from '@cairn/ui';
import { SUPPORTED_UPLOAD_EXTENSIONS } from '@cairn/ingestion';
import { AppShell } from '@/components/chrome';
import { ActionForm, PasteForm, SubmitButton, UploadForm, UrlForm } from '@/components/forms';
import { providerLabel } from '@/components/memory-card';
import {
  addPastedText,
  addUploadedFiles,
  addWebPage,
  connectSource,
  disconnectSource,
  syncConnection,
} from '@/server/actions';
import { csrfToken, requireContext } from '@/server/context';
import { loadSources } from '@/server/views';

export const metadata = { title: 'Apps' };
export const dynamic = 'force-dynamic';

/**
 * How long ago, in words.
 *
 * The question someone has about a connected source is whether it is current,
 * and a timestamp makes them do arithmetic to answer it. "Checked 2 hours ago"
 * answers it directly; "2026-07-31 14:32" answers a question nobody asked.
 *
 * Coarse on purpose. Nothing here is decided by the difference between 40 and
 * 50 minutes, and false precision invites scrutiny the number cannot support.
 */
function sinceInWords(when: Date, now = new Date()): string {
  const minutes = Math.floor((now.getTime() - when.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  // Past a month the exact figure stops carrying meaning and the point becomes
  // simply that it is stale.
  return days > 30 ? 'over a month ago' : `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * How much is connected, said once and plainly.
 *
 * This used to quote the two internal thresholds — "works from 2, better from
 * 3" — as if they were targets the reader had agreed to. They are tuning
 * figures for the answer quality, and printed as bare numbers they read as a
 * quota someone is behind on. What is actually true is simpler: none of this
 * is required, and each one added gives answers more to draw on.
 */
function connectedAppsNote(count: number): string {
  const sources = (n: number) => `${n} source${n === 1 ? '' : 's'}`;
  if (count >= RECOMMENDED_CONNECTED_APPS) return `${sources(count)} connected.`;
  if (count === 0) {
    return 'Nothing connected, which is fine — pasting and uploading work on their own. Connecting one keeps your memory up to date without you doing anything.';
  }
  return `${sources(count)} connected. Each one you add gives your answers more to draw on.`;
}

export default async function SourcesPage() {
  const context = await requireContext();
  const csrf = await csrfToken();
  const view = await loadSources(context);
  const { mode, scheduledSync } = context.services.config;
  const projectId = context.project.id;
  // "Live" matches the definition setup_status uses elsewhere: state === 'active'.
  // A connection that exists but is disconnected or needs reconnecting is not
  // one of the sources actually feeding memory right now.
  const connectedCount = view.connections.filter((c) => c.state === 'active').length;
  // Cloud deployments cannot offer the demo-form affordance for a provider
  // that is missing required setup — there is no demo to add to there, only a
  // redeploy that would fix it. Demo mode, and any provider whose status is
  // 'demo' rather than 'setup-required', keeps the existing behaviour.
  const unavailableHere = view.available.filter(
    (entry) => mode === 'cloud' && entry.status === 'setup-required',
  );
  const availableToTry = view.available.filter((entry) => !unavailableHere.includes(entry));

  return (
    <AppShell current="/sources" email={context.email}>
      <h1 className="cairn-page-title">Apps</h1>
      <p className="cairn-page-lede">
        Keep your memory current from documents and places you already use. Every connection is
        read-only: Cairn never changes the originals.
      </p>

      {/* People arrive here looking for Claude and ChatGPT, because "connect an
          app" sounds like the AI-tool step. Say where that actually lives
          before they read a page about document storage and conclude this is a
          file-sync product. */}
      <div style={{ marginBottom: '2rem' }}>
        <Callout tone="info" title="Looking for Claude, Codex or ChatGPT?">
          Those are under <Link href="/connections">AI tools</Link>. This page is about the
          documents your memory is built from.
        </Callout>
      </div>

      <section aria-labelledby="add-now" style={{ marginBottom: '2.5rem' }}>
        <h2 id="add-now" className="cairn-section-title">
          Add something now
        </h2>
        <div className="cairn-stack cairn-stack--md">
          <Card>
            <h3 className="cairn-card__title">Paste text</h3>
            <PasteForm action={addPastedText} csrf={csrf} projectId={projectId} />
          </Card>
          <Card>
            <h3 className="cairn-card__title">Upload files</h3>
            <UploadForm
              action={addUploadedFiles}
              csrf={csrf}
              projectId={projectId}
              accept={SUPPORTED_UPLOAD_EXTENSIONS.join(',')}
            />
          </Card>
          <Card>
            <h3 className="cairn-card__title">Add a web page</h3>
            <UrlForm action={addWebPage} csrf={csrf} projectId={projectId} />
          </Card>
        </div>
      </section>

      <section aria-labelledby="connections" style={{ marginBottom: '2.5rem' }}>
        <h2 id="connections" className="cairn-section-title">
          Connected apps
        </h2>
        <p style={{ color: 'var(--cairn-ink-muted)', marginTop: 0 }}>
          {connectedAppsNote(connectedCount)}
        </p>

        {view.connections.length === 0 ? (
          <EmptyState title="Nothing connected">
            Connecting an app keeps your memory up to date without you doing anything.
          </EmptyState>
        ) : (
          <div className="cairn-stack cairn-stack--md">
            {view.connections.map((connection) => (
              <Card key={connection.id}>
                <div className="cairn-card__header">
                  <div>
                    <h3 className="cairn-card__title">{connection.displayName}</h3>
                    <div className="cairn-meta" style={{ marginTop: '0.25rem' }}>
                      <ConnectionBadge state={connection.state} />
                      <span>
                        {connection.lastSyncedAt
                          ? `Checked ${sinceInWords(connection.lastSyncedAt)}`
                          : 'Not checked yet'}
                      </span>
                      {/* Says which of the two worlds this deployment is in.
                          Claiming an automatic refresh that no scheduler is
                          configured to perform would be the worse lie of the
                          two, so the manual wording stays the default. */}
                      {connection.state !== 'disconnected' ? (
                        <span>
                          {scheduledSync
                            ? 'Checked every few hours, and whenever you click Check for updates'
                            : 'Only when you click Check for updates — nothing runs on its own'}
                        </span>
                      ) : null}
                      {connection.externalAccountLabel ? (
                        <span>{connection.externalAccountLabel}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="cairn-row">
                    {connection.state !== 'disconnected' ? (
                      <ActionForm
                        action={syncConnection}
                        csrf={csrf}
                        hidden={{ connectionId: connection.id, projectId }}
                      >
                        <SubmitButton tone="secondary" busyLabel="Checking…">
                          Check for updates
                        </SubmitButton>
                      </ActionForm>
                    ) : null}
                    {connection.state !== 'disconnected' ? (
                      <ActionForm
                        action={disconnectSource}
                        csrf={csrf}
                        hidden={{ connectionId: connection.id }}
                      >
                        <SubmitButton tone="quiet" busyLabel="Disconnecting…">
                          Disconnect
                        </SubmitButton>
                      </ActionForm>
                    ) : null}
                  </div>
                </div>

                {connection.lastError ? (
                  <Callout tone="warn" title="Last check did not finish">
                    {connection.lastError}
                  </Callout>
                ) : null}

                <Disclosure summary="What this reads, and what disconnecting does">
                  <p>{describe(connection.provider).permissionSummary}</p>
                  <p>{describe(connection.provider).disconnectSummary}</p>
                </Disclosure>
              </Card>
            ))}
          </div>
        )}

        <h3 className="cairn-section-title" style={{ marginTop: '1.75rem' }}>
          Available to connect
        </h3>
        <div className="cairn-grid">
          {availableToTry.map((entry) => (
            <Card key={entry.provider}>
              <div className="cairn-card__header">
                <div>
                  <h4 className="cairn-card__title">{entry.description.displayName}</h4>
                  <p className="cairn-card__description">{entry.description.summary}</p>
                </div>
                {entry.status === 'ready' ? (
                  <Badge tone="good">Ready</Badge>
                ) : (
                  // Not "Setup required": nothing is required of the reader.
                  // Whoever runs this copy of Cairn is the one who has not
                  // finished, and the card below says so.
                  <Badge tone="warn">Sample documents only</Badge>
                )}
              </div>
              {entry.status !== 'ready' ? (
                <Callout tone="info">
                  Whoever runs this copy of the app has not set up {entry.description.displayName}{' '}
                  yet. You can still add it to see how it would work — it will use sample documents
                  and say so.
                </Callout>
              ) : null}
              <Disclosure summary="What it reads before you connect">
                <p>{entry.description.permissionSummary}</p>
                <p>{entry.description.disconnectSummary}</p>
              </Disclosure>
              <div style={{ marginTop: '0.875rem' }}>
                <ActionForm
                  action={connectSource}
                  csrf={csrf}
                  hidden={{ provider: entry.provider, projectId }}
                >
                  <SubmitButton tone="primary" busyLabel="Connecting…">
                    {entry.status === 'ready' ? 'Connect' : 'Try it with sample documents'}
                  </SubmitButton>
                </ActionForm>
              </div>
            </Card>
          ))}
        </div>

        {unavailableHere.length > 0 ? (
          <>
            <h3 className="cairn-section-title" style={{ marginTop: '1.75rem' }}>
              Not switched on here
            </h3>
            <p style={{ color: 'var(--cairn-ink-muted)', marginTop: 0 }}>
              Whoever runs this copy of Cairn has not switched these on. Nothing you can do on this
              page will change that, so there is nothing to try — everything above still works.
            </p>
            <div className="cairn-grid">
              {unavailableHere.map((entry) => (
                <Card key={entry.provider}>
                  <div className="cairn-card__header">
                    <div>
                      <h4 className="cairn-card__title">{entry.description.displayName}</h4>
                      <p className="cairn-card__description">{entry.description.summary}</p>
                    </div>
                    <Badge tone="neutral">Not switched on here</Badge>
                  </div>
                  <Disclosure summary="What it would read, if it were available">
                    <p>{entry.description.permissionSummary}</p>
                    <p>{entry.description.disconnectSummary}</p>
                  </Disclosure>
                </Card>
              ))}
            </div>
          </>
        ) : null}
      </section>

      <section aria-labelledby="documents" style={{ marginBottom: '2.5rem' }}>
        <h2 id="documents" className="cairn-section-title">
          Documents read ({view.items.length})
        </h2>
        {view.items.length === 0 ? (
          <EmptyState title="Nothing read yet">Add something above to get started.</EmptyState>
        ) : (
          <div className="cairn-table-wrap">
            <table className="cairn-table">
              <caption className="cairn-visually-hidden">Documents that have been read</caption>
              <thead>
                <tr>
                  <th scope="col">Document</th>
                  <th scope="col">Where from</th>
                  <th scope="col">Added</th>
                </tr>
              </thead>
              <tbody>
                {view.items.map((item) => (
                  <tr key={item.id}>
                    <th scope="row" style={{ fontWeight: 550 }}>
                      {item.canonicalUri ? (
                        <a
                          href={item.canonicalUri}
                          rel="noreferrer noopener nofollow"
                          target="_blank"
                        >
                          {item.title}
                        </a>
                      ) : (
                        item.title
                      )}
                    </th>
                    <td>{providerLabel(item.provider)}</td>
                    <td>{item.createdAt.toISOString().slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="activity" id="activity">
        <h2 id="activity" className="cairn-section-title">
          Recent activity
        </h2>
        {view.jobs.length === 0 ? (
          <EmptyState title="Nothing has run yet" />
        ) : (
          <div className="cairn-table-wrap">
            <table className="cairn-table">
              <caption className="cairn-visually-hidden">Background work</caption>
              <thead>
                <tr>
                  <th scope="col">What</th>
                  <th scope="col">State</th>
                  <th scope="col">Tries</th>
                  <th scope="col">Took</th>
                  <th scope="col">Problem</th>
                </tr>
              </thead>
              <tbody>
                {view.jobs.map((job) => (
                  <tr key={job.id}>
                    <th scope="row" style={{ fontWeight: 550 }}>
                      {jobLabel(job.type)}
                    </th>
                    <td>
                      <JobBadge state={job.state} />
                    </td>
                    <td>{job.attempts}</td>
                    <td>{job.durationMs ? `${job.durationMs} ms` : '—'}</td>
                    <td>
                      {job.lastError ? problemInWords(job.errorCategory, job.lastError) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}

function describe(provider: SourceProvider) {
  return CONNECTOR_DESCRIPTIONS[provider] ?? CONNECTOR_DESCRIPTIONS.paste;
}

function ConnectionBadge({ state }: { state: string }) {
  if (state === 'active') return <Badge tone="good">Connected</Badge>;
  if (state === 'setup_required') return <Badge tone="warn">Sample documents only</Badge>;
  if (state === 'needs_reconnect') return <Badge tone="warn">Needs reconnecting</Badge>;
  if (state === 'disconnected') return <Badge tone="neutral">Disconnected</Badge>;
  return <Badge tone="danger">Problem</Badge>;
}

function JobBadge({ state }: { state: string }) {
  if (state === 'succeeded') return <Badge tone="good">Done</Badge>;
  if (state === 'running') return <Badge tone="info">Running</Badge>;
  if (state === 'queued') return <Badge tone="neutral">Waiting</Badge>;
  if (state === 'dead') return <Badge tone="danger">Gave up</Badge>;
  return <Badge tone="warn">Retrying</Badge>;
}

function jobLabel(type: string): string {
  switch (type) {
    case 'source.ingest':
      return 'Reading a document';
    case 'source.extract':
      return 'Finding what to remember';
    case 'memory.reconcile':
      return 'Checking for disagreements';
    case 'index.rebuild':
      return 'Rebuilding search';
    case 'connection.sync':
      return 'Checking a connected app';
    case 'vault.commit':
      return 'Saving a new version';
    case 'backup.create':
      return 'Making a backup';
    case 'workspace.delete':
      return 'Deleting a workspace';
    case 'query.deep':
      return 'Answering a long question';
    // A new kind of work should never surface its internal name here. The row
    // is about whether something finished, and "Background work" answers that
    // just as well as a dotted identifier nobody can act on.
    default:
      return 'Background work';
  }
}

/**
 * The stored failure, in words.
 *
 * `errorCategory` is a `DomainError` code — `setup_required`, `budget_exceeded`,
 * `transient` — and printing it raw put snake_case identifiers in a table cell
 * on a page ordinary people read. The underlying message is already written for
 * a person, so the category only needs to say what kind of problem it was, and
 * only when it adds something.
 */
function problemInWords(category: string | null, message: string): string {
  switch (category) {
    case 'setup_required':
      return `Not set up yet — ${message}`;
    case 'budget_exceeded':
      return `Monthly limit reached — ${message}`;
    case 'unauthorized':
    case 'forbidden':
      return `Permission was refused — ${message}`;
    case 'not_found':
      return `Could not be found — ${message}`;
    case 'transient':
      return `A temporary problem — ${message}`;
    default:
      return message;
  }
}
