import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SUPPORTED_UPLOAD_EXTENSIONS } from '@cairn/ingestion';
import { Callout, Card, ProgressSteps } from '@cairn/ui';
import { AppShell } from '@/components/chrome';
import { ActionForm, PasteForm, UploadForm, UrlForm } from '@/components/forms';
import { MemoryCard } from '@/components/memory-card';
import { RecentDecisions } from '@/components/recent-decisions';
import { addPastedText, addUploadedFiles, addWebPage, loadExample } from '@/server/actions';
import { csrfToken, requireContext } from '@/server/context';
import { loadOverview } from '@/server/views';

export const metadata = { title: 'Welcome' };
export const dynamic = 'force-dynamic';

/**
 * First run.
 *
 * One question, four ways to answer it, and no vocabulary a person has to learn
 * first. The AI-connection step is deliberately not here: it appears only after
 * there is something worth connecting to.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ how?: string }>;
}) {
  const context = await requireContext();
  const csrf = await csrfToken();
  const overview = await loadOverview(context);
  const params = await searchParams;
  const how = params.how ?? '';

  // Someone who has already kept something is a returning visitor, not a new one.
  // Anyone mid-first-run stays here so the results appear where they clicked,
  // rather than being bounced to another screen.
  if (overview.approvedCount > 0 && !how) redirect('/home');

  return (
    <AppShell current="/home" email={context.email} narrow>
      <h1 className="cairn-page-title">What would you like your AI to remember?</h1>
      <p className="cairn-page-lede">
        Anything you find yourself explaining over and over. A project, how you like things done,
        who is involved, what was decided.
      </p>

      {!how ? (
        <div className="cairn-choice-grid">
          <ActionForm action={loadExample} csrf={csrf} hidden={{ projectId: context.project.id }}>
            <button type="submit" className="cairn-choice-card">
              <span className="cairn-choice-card__title">Try an example</span>
              <span className="cairn-choice-card__body">
                See how it works with a sample project. You can delete it afterwards.
              </span>
            </button>
          </ActionForm>
          <Link href="/welcome?how=paste" className="cairn-choice-card">
            <span className="cairn-choice-card__title">Paste something</span>
            <span className="cairn-choice-card__body">
              Notes, an email, a plan — anything written.
            </span>
          </Link>
          <Link href="/welcome?how=upload" className="cairn-choice-card">
            <span className="cairn-choice-card__title">Upload a file</span>
            <span className="cairn-choice-card__body">A Word document, a PDF, or a text file.</span>
          </Link>
          <Link href="/sources" className="cairn-choice-card">
            <span className="cairn-choice-card__title">Connect an app</span>
            <span className="cairn-choice-card__body">
              Keep memory up to date from somewhere you already keep documents.
            </span>
          </Link>
        </div>
      ) : (
        <Card>
          <div className="cairn-card__header">
            <div>
              <h2 className="cairn-card__title">
                {how === 'upload'
                  ? 'Upload a file'
                  : how === 'url'
                    ? 'Add a web page'
                    : 'Paste something'}
              </h2>
              <p className="cairn-card__description">
                It stays private to you. Nothing is shared with any AI tool until you choose to
                connect one.
              </p>
            </div>
            <Link href="/welcome" className="cairn-button cairn-button--quiet">
              Back
            </Link>
          </div>
          {how === 'upload' ? (
            <UploadForm
              action={addUploadedFiles}
              csrf={csrf}
              projectId={context.project.id}
              accept={SUPPORTED_UPLOAD_EXTENSIONS.join(',')}
            />
          ) : how === 'url' ? (
            <UrlForm action={addWebPage} csrf={csrf} projectId={context.project.id} />
          ) : (
            <PasteForm action={addPastedText} csrf={csrf} projectId={context.project.id} />
          )}
        </Card>
      )}

      {overview.proposals.length > 0 ? (
        <section style={{ marginTop: '2.5rem' }} aria-labelledby="found">
          <ProgressSteps
            steps={[
              { label: 'Reading', state: 'done' },
              { label: 'Organizing', state: overview.runningJobs > 0 ? 'active' : 'done' },
              { label: 'Ready', state: overview.runningJobs > 0 ? 'pending' : 'done' },
            ]}
          />
          <RecentDecisions decisions={overview.recentlyDecided} csrf={csrf} returnTo="/welcome" />
          <h2 id="found" className="cairn-section-title" style={{ marginTop: '1.25rem' }}>
            Here is what I found
          </h2>
          <p style={{ color: 'var(--cairn-ink-muted)', marginTop: 0 }}>
            Nothing is saved until you keep it. Anything you remove can be undone from History.
          </p>
          <div className="cairn-stack cairn-stack--md">
            {overview.proposals.slice(0, 6).map((card) => (
              <MemoryCard
                key={card.item.id}
                card={card}
                csrf={csrf}
                projectId={context.project.id}
              />
            ))}
          </div>
          <div style={{ marginTop: '1.5rem' }}>
            <Link href="/home" className="cairn-button cairn-button--primary cairn-button--lg">
              Go to my memory
            </Link>
          </div>
        </section>
      ) : overview.runningJobs > 0 ? (
        <div style={{ marginTop: '1.5rem' }}>
          <Callout tone="info" live="polite">
            Still reading. Refresh this page in a moment.
          </Callout>
        </div>
      ) : null}
    </AppShell>
  );
}
