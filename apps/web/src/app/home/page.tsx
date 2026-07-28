import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge, Callout, Card, EmptyState, ProgressSteps } from '@cairn/ui';
import { AppShell } from '@/components/chrome';
import { MemoryCard } from '@/components/memory-card';
import { RecentDecisions } from '@/components/recent-decisions';
import { csrfToken, requireContext, workspaceName } from '@/server/context';
import { loadOverview } from '@/server/views';

export const metadata = { title: 'Home' };
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const context = await requireContext();
  const csrf = await csrfToken();
  const overview = await loadOverview(context);
  const name = await workspaceName(context);

  if (
    overview.approvedCount === 0 &&
    overview.proposals.length === 0 &&
    overview.sourceCount === 0
  ) {
    redirect('/welcome');
  }

  return (
    <AppShell current="/home" email={context.email}>
      <h1 className="cairn-page-title">{name}</h1>
      <p className="cairn-page-lede">
        {overview.approvedCount === 0
          ? 'Nothing is saved yet. Review what was found below and keep the parts that are right.'
          : `${overview.approvedCount} thing${overview.approvedCount === 1 ? '' : 's'} saved, from ${overview.sourceCount} source${overview.sourceCount === 1 ? '' : 's'}.`}
      </p>

      {overview.runningJobs > 0 ? (
        <div style={{ marginBottom: '1.5rem' }}>
          <ProgressSteps
            steps={[
              { label: 'Reading', state: 'done' },
              { label: 'Organizing', state: 'active' },
              { label: 'Ready', state: 'pending' },
            ]}
          />
        </div>
      ) : null}

      {overview.failedJobs > 0 ? (
        <div style={{ marginBottom: '1.5rem' }}>
          <Callout tone="warn" title="Something did not finish">
            {overview.failedJobs} job{overview.failedJobs === 1 ? '' : 's'} stopped after several
            tries. <Link href="/sources#activity">See what happened and try again</Link>.
          </Callout>
        </div>
      ) : null}

      {overview.conflictCount > 0 ? (
        <div style={{ marginBottom: '1.5rem' }}>
          <Callout tone="warn" title="Two notes disagree">
            <Link href="/memory?filter=conflicted">Choose which one is right</Link>. Nothing was
            overwritten — both are still here.
          </Callout>
        </div>
      ) : null}

      <section aria-labelledby="what-i-know" style={{ marginBottom: '2.5rem' }}>
        <h2 id="what-i-know" className="cairn-section-title">
          What I know
        </h2>
        {overview.approvedByType.length === 0 ? (
          <EmptyState title="Nothing saved yet">
            Once you keep something below, it appears here and becomes available to any AI tool you
            connect.
          </EmptyState>
        ) : (
          <div className="cairn-grid">
            {overview.approvedByType.map((group) => (
              <Card key={group.type}>
                <div className="cairn-row" style={{ justifyContent: 'space-between' }}>
                  <h3 className="cairn-card__title">{group.label}</h3>
                  <Badge tone="neutral">{group.count}</Badge>
                </div>
                <ul
                  style={{
                    margin: '0.625rem 0 0',
                    paddingLeft: '1.125rem',
                    color: 'var(--cairn-ink-muted)',
                  }}
                >
                  {group.samples.map((sample) => (
                    <li key={sample}>{sample}</li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
        {overview.latestVersion ? (
          <p className="cairn-meta" style={{ marginTop: '0.875rem' }}>
            Last change: {overview.latestVersion.reason} by {overview.latestVersion.authorLabel} on{' '}
            {overview.latestVersion.createdAt.toISOString().slice(0, 10)} ·{' '}
            <Link href="/history">See history</Link>
          </p>
        ) : null}
      </section>

      <RecentDecisions decisions={overview.recentlyDecided} csrf={csrf} returnTo="/home" />

      <section aria-labelledby="to-review">
        <h2 id="to-review" className="cairn-section-title">
          {overview.proposals.length > 0
            ? `Waiting for you (${overview.proposals.length})`
            : 'Nothing waiting for you'}
        </h2>
        {overview.proposals.length === 0 ? (
          <EmptyState
            title="You are all caught up"
            action={
              <Link href="/sources" className="cairn-button cairn-button--primary">
                Add something else
              </Link>
            }
          >
            When you add a document or an app has something new, anything worth remembering shows up
            here first.
          </EmptyState>
        ) : (
          <div className="cairn-stack cairn-stack--md">
            {overview.proposals.map((card) => (
              <MemoryCard
                key={card.item.id}
                card={card}
                csrf={csrf}
                projectId={context.project.id}
              />
            ))}
          </div>
        )}
      </section>

      <section style={{ marginTop: '2.5rem' }} aria-labelledby="next">
        <h2 id="next" className="cairn-section-title">
          What next
        </h2>
        <div className="cairn-choice-grid">
          <Link href="/ask" className="cairn-choice-card">
            <span className="cairn-choice-card__title">Ask a question</span>
            <span className="cairn-choice-card__body">
              Every answer shows the exact words it came from.
            </span>
          </Link>
          <Link href="/sources" className="cairn-choice-card">
            <span className="cairn-choice-card__title">Add more</span>
            <span className="cairn-choice-card__body">Paste, upload, or connect an app.</span>
          </Link>
          <Link href="/connections" className="cairn-choice-card">
            <span className="cairn-choice-card__title">Use this in an AI tool</span>
            <span className="cairn-choice-card__body">
              Let a tool you already use look things up here. Reversible at any time.
            </span>
          </Link>
        </div>
      </section>
    </AppShell>
  );
}
