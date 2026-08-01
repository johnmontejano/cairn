import { CONNECTOR_DESCRIPTIONS } from '@cairn/connectors';
import {
  MINIMUM_CONNECTED_APPS,
  RECOMMENDED_CONNECTED_APPS,
  type SourceProvider,
} from '@cairn/domain';
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

export const metadata = { title: 'Sources' };
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
 * "Works from N, better from 3" — said once, plainly.
 *
 * Two is where the product proves the mechanism; three is where the answers
 * actually get good. Neither number is a failure state, so the wording never
 * tells anyone they are short of anything — it just says what is true at each
 * count.
 */
function connectedAppsNote(count: number): string {
  const sources = (n: number) => `${n} source${n === 1 ? '' : 's'}`;
  if (count >= RECOMMENDED_CONNECTED_APPS) return `${sources(count)} connected.`;
  if (count === 0) {
    return `Nothing connected yet. Works from ${MINIMUM_CONNECTED_APPS}, and gets noticeably better from ${RECOMMENDED_CONNECTED_APPS}.`;
  }
  return `Works from ${sources(count)}. Gets noticeably better from ${RECOMMENDED_CONNECTED_APPS}.`;
}

export default async function SourcesPage() {
  const context = await requireContext();
  const csrf = await csrfToken();
  const view = await loadSources(context);
  const { mode } = context.services.config;
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
      <h1 className="cairn-page-title">Sources</h1>
      <p className="cairn-page-lede">
        Where your memory comes from. Everything here is read-only: nothing is ever changed in the
        places you connect.
      </p>

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
                      {connection.state !== 'disconnected' ? (
                        <span>Only when you click Check for updates — nothing runs on its own</span>
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
                  <Badge tone="warn">Setup required</Badge>
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
                    {entry.status === 'ready' ? 'Connect' : 'Add in demo form'}
                  </SubmitButton>
                </ActionForm>
              </div>
            </Card>
          ))}
        </div>

        {unavailableHere.length > 0 ? (
          <>
            <h3 className="cairn-section-title" style={{ marginTop: '1.75rem' }}>
              Not available on this deployment
            </h3>
            <p style={{ color: 'var(--cairn-ink-muted)', marginTop: 0 }}>
              Whoever runs this copy of the app has not turned these on, and that will not change
              without a redeploy — there is nothing to try here.
            </p>
            <div className="cairn-grid">
              {unavailableHere.map((entry) => (
                <Card key={entry.provider}>
                  <div className="cairn-card__header">
                    <div>
                      <h4 className="cairn-card__title">{entry.description.displayName}</h4>
                      <p className="cairn-card__description">{entry.description.summary}</p>
                    </div>
                    <Badge tone="neutral">Not available on this deployment</Badge>
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
                    <td>{job.lastError ? `${job.errorCategory}: ${job.lastError}` : '—'}</td>
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
  if (state === 'setup_required') return <Badge tone="warn">Demo — setup required</Badge>;
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
    case 'index.rebuild':
      return 'Rebuilding search';
    case 'connection.sync':
      return 'Checking a connected app';
    case 'vault.commit':
      return 'Saving a new version';
    default:
      return type;
  }
}
