import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CANONICAL_DOCS } from '@cairn/domain';
import { Badge, Callout, Card, EmptyState, ProgressSteps } from '@cairn/ui';
import { AppShell } from '@/components/chrome';
import { RecentDecisions } from '@/components/recent-decisions';
import { ReviewQueue } from '@/components/review-queue';
import { csrfToken, requireContext, workspaceName } from '@/server/context';
import { loadOverview } from '@/server/views';

export const metadata = { title: 'Home' };
export const dynamic = 'force-dynamic';

/**
 * Below this many characters, `overview.identity.summary` reads as a
 * fragment rather than a sentence (e.g. one short preference on its own) —
 * the plain count lede below is the clearer "first thing read" until there
 * is enough for the identity summary to stand on its own.
 */
const MIN_IDENTITY_LEDE_CHARS = 40;

/**
 * A lede is a teaser, not the whole story — the "What I know" section below
 * already lists every saved item by category. Past this many characters the
 * lede is cut at the nearest earlier sentence boundary, never mid-sentence.
 */
const MAX_IDENTITY_LEDE_CHARS = 220;

/**
 * Once this many memories are approved, a connected AI is likely to have
 * something real to answer with — enough saved that answering something
 * plausible is likely.
 */
const CONNECT_CTA_APPROVED_THRESHOLD = 5;

/**
 * `assembleIdentity` (in `@cairn/search`) builds its summary for a
 * connected AI: headed sections, `<!-- cairn:type -->` markers meant to
 * survive a round trip, one bullet per item. Read by a person as the page
 * lede, the markers and `##`/`-` syntax would just be visible clutter, so
 * this is the one place that turns the same markdown into a plain sentence
 * for a human reader instead.
 */
function identityLedeText(markdown: string): string {
  const full = markdown
    .split('\n')
    .filter((line) => line.trim().length > 0 && !line.startsWith('<!--'))
    .map((line) => {
      const heading = line.match(/^##\s*(.+)$/);
      if (heading) return `${heading[1]}:`;
      const item = line.replace(/^- /, '').trim();
      return /[.!?]$/.test(item) ? item : `${item}.`;
    })
    .join(' ');

  if (full.length <= MAX_IDENTITY_LEDE_CHARS) return full;

  // A lede is a teaser: cut at the last full sentence that fits, never
  // mid-sentence. Everything else is already listed in "What I know" below.
  const window = full.slice(0, MAX_IDENTITY_LEDE_CHARS);
  const lastSentenceEnd = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('.', window.length - 1),
  );
  return lastSentenceEnd > MIN_IDENTITY_LEDE_CHARS
    ? window.slice(0, lastSentenceEnd + 1)
    : `${window.trimEnd()}…`;
}

/** "a", "a and b", or "a, b, and c" — for naming missing identity sections inline. */
function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

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

  // A prose summary of who the person is beats a raw count as the first
  // thing read here — but only once there is enough of one to read as a
  // sentence rather than a stub. Below that, or for a workspace with
  // nothing approved yet, today's count-only copy is what leads instead.
  const identityLede =
    overview.identity.summary.length >= MIN_IDENTITY_LEDE_CHARS
      ? identityLedeText(overview.identity.summary)
      : null;
  const missingLabels = overview.identity.missing.map((type) =>
    CANONICAL_DOCS[type].title.toLowerCase(),
  );
  const countLede = `${overview.approvedCount} thing${overview.approvedCount === 1 ? '' : 's'} saved, from ${overview.sourceCount} source${overview.sourceCount === 1 ? '' : 's'}.`;

  return (
    <AppShell current="/home" email={context.email}>
      <h1 className="cairn-page-title">{name}</h1>
      {identityLede ? (
        <>
          <p className="cairn-page-lede">
            {identityLede}
            {missingLabels.length > 0
              ? ` Nothing saved yet about ${joinWithAnd(missingLabels)}.`
              : ''}
          </p>
          <p className="cairn-meta" style={{ marginTop: '-1rem', marginBottom: '1.75rem' }}>
            {countLede}
          </p>
        </>
      ) : (
        <p className="cairn-page-lede">
          {overview.approvedCount === 0
            ? 'Nothing is saved yet. Review what was found below and keep the parts that are right.'
            : countLede}
        </p>
      )}

      {/* A progress bar says work is happening. It does not say what that means
          for an answer asked right now, which is the thing worth knowing: a
          question asked mid-import returns less than it will in a minute, and
          without being told so, a thin answer reads as the product failing
          rather than as a temporary state. */}
      {overview.runningJobs > 0 ? (
        <div style={{ marginBottom: '1.5rem' }}>
          <ProgressSteps
            steps={[
              { label: 'Reading', state: 'done' },
              { label: 'Organizing', state: 'active' },
              { label: 'Ready', state: 'pending' },
            ]}
          />
          <div style={{ marginTop: '0.75rem' }}>
            <Callout tone="info" live="polite">
              Still reading {overview.runningJobs} thing
              {overview.runningJobs === 1 ? '' : 's'}. You can ask questions now, but answers may
              miss whatever has not been read yet.
            </Callout>
          </div>
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
          <ReviewQueue cards={overview.proposals} csrf={csrf} projectId={context.project.id} />
        )}
      </section>

      <section style={{ marginTop: '2.5rem' }} aria-labelledby="next">
        <h2 id="next" className="cairn-section-title">
          What next
        </h2>
        {overview.hasConnectedAi ? (
          // A connection already exists, so the pitch for one has done its
          // job and retires rather than continuing to compete for attention
          // next to the two choices that are still live either way.
          <>
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
            </div>
            <p className="cairn-meta" style={{ marginTop: '0.875rem' }}>
              <Link href="/connections">Manage your connected AI</Link>
            </p>
          </>
        ) : (
          <div className="cairn-choice-grid">
            {overview.approvedCount >= CONNECT_CTA_APPROVED_THRESHOLD ? (
              <Link href="/connections" className="cairn-choice-card cairn-choice-card--accent">
                <span className="cairn-choice-card__title">Use this in an AI tool</span>
                <span className="cairn-choice-card__body">
                  You have enough saved that a connected tool can answer something real. Reversible
                  at any time.
                </span>
              </Link>
            ) : null}
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
            {overview.approvedCount < CONNECT_CTA_APPROVED_THRESHOLD ? (
              <Link href="/connections" className="cairn-choice-card">
                <span className="cairn-choice-card__title">Use this in an AI tool</span>
                <span className="cairn-choice-card__body">
                  Let a tool you already use look things up here. Reversible at any time.
                </span>
              </Link>
            ) : null}
          </div>
        )}
      </section>
    </AppShell>
  );
}
