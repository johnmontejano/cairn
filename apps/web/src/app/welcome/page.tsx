import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SUPPORTED_UPLOAD_EXTENSIONS } from '@cairn/ingestion';
import { Callout, Card, ProgressSteps } from '@cairn/ui';
import { AppShell } from '@/components/chrome';
import { ActionForm, PasteForm, UploadForm, UrlForm } from '@/components/forms';
import { LiveProgress } from '@/components/live-progress';
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
 * One question, five ways to answer it, and no vocabulary a person has to learn
 * first.
 *
 * Connecting an AI tool leads, and deliberately so. It used to be held back
 * until there was something worth connecting to, on the reasoning that an
 * empty memory makes a poor first impression — but most people arrive wanting
 * exactly one thing, which is for the tools they already use to stop asking
 * them the same questions. Hiding that behind a nav label they were not
 * looking for meant the only screen a new person sees never mentioned it at
 * all. Connecting first costs nothing: a connection made now picks up
 * everything saved afterwards without being set up again, and the lede says so
 * plainly so nobody reads an empty first answer as the product being broken.
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
        who is involved, what was decided. Start wherever you like — hooking up your AI tools first
        is fine, and whatever you save later shows up in them without setting anything up again.
      </p>

      {!how ? (
        <>
          <section className="cairn-onboarding" aria-labelledby="choose-first-ai">
            <div className="cairn-onboarding__intro">
              <p className="cairn-eyebrow">1 · Connect one AI</p>
              <h2 id="choose-first-ai" className="cairn-section-title">
                Choose where your memory should show up first
              </h2>
              <p>
                Start with one. You can add the others later, and each connected tool reads from the
                same approved memory within the permissions you give it.
              </p>
            </div>
            <nav className="cairn-agent-picker" aria-label="Choose an AI tool">
              <Link href="/connections?tool=claude" className="cairn-agent-choice">
                <span className="cairn-agent-choice__mark" aria-hidden="true">
                  Cl
                </span>
                <span>
                  <strong className="cairn-agent-choice__name">Claude</strong>
                  <span className="cairn-agent-choice__detail">Web and desktop</span>
                </span>
              </Link>
              <Link href="/connections?tool=claude-code" className="cairn-agent-choice">
                <span className="cairn-agent-choice__mark" aria-hidden="true">
                  &gt;_
                </span>
                <span>
                  <strong className="cairn-agent-choice__name">Claude Code</strong>
                  <span className="cairn-agent-choice__detail">Terminal agent</span>
                </span>
              </Link>
              <Link href="/connections?tool=codex" className="cairn-agent-choice">
                <span className="cairn-agent-choice__mark" aria-hidden="true">
                  Cx
                </span>
                <span>
                  <strong className="cairn-agent-choice__name">Codex</strong>
                  <span className="cairn-agent-choice__detail">App, terminal, editor</span>
                </span>
              </Link>
              <Link href="/connections?tool=chatgpt" className="cairn-agent-choice">
                <span className="cairn-agent-choice__mark" aria-hidden="true">
                  GPT
                </span>
                <span>
                  <strong className="cairn-agent-choice__name">ChatGPT</strong>
                  <span className="cairn-agent-choice__detail">Workspace plan required</span>
                </span>
              </Link>
            </nav>
            <ol className="cairn-onboarding-track" aria-label="Setup steps">
              <li>
                <strong>Choose</strong>
                <span>Pick the AI you already use.</span>
              </li>
              <li>
                <strong>Approve</strong>
                <span>Sign in and say yes once.</span>
              </li>
              <li>
                <strong>Remember</strong>
                <span>Keep the first useful fact.</span>
              </li>
            </ol>
          </section>

          <section className="cairn-onboarding-secondary" aria-labelledby="start-with-memory">
            <div className="cairn-section-head">
              <div>
                <p className="cairn-eyebrow">Or start with memory</p>
                <h2 id="start-with-memory" className="cairn-section-title">
                  Give Cairn something useful first
                </h2>
              </div>
              <span className="cairn-note">Your AI can be connected afterwards.</span>
            </div>
            <div className="cairn-choice-grid cairn-choice-grid--compact">
              <ActionForm
                action={loadExample}
                csrf={csrf}
                hidden={{ projectId: context.project.id }}
              >
                <button type="submit" className="cairn-choice-card cairn-choice-card--accent">
                  <span className="cairn-choice-card__title">Try an example</span>
                  <span className="cairn-choice-card__body">
                    See a sample project before adding your own information.
                  </span>
                </button>
              </ActionForm>
              <Link href="/welcome?how=paste" className="cairn-choice-card">
                <span className="cairn-choice-card__title">Paste notes</span>
                <span className="cairn-choice-card__body">
                  An email, a plan, or written context.
                </span>
              </Link>
              <Link href="/welcome?how=upload" className="cairn-choice-card">
                <span className="cairn-choice-card__title">Upload a file</span>
                <span className="cairn-choice-card__body">A Word document, PDF, or text file.</span>
              </Link>
              <Link href="/sources" className="cairn-choice-card">
                <span className="cairn-choice-card__title">Connect an app</span>
                <span className="cairn-choice-card__body">
                  Google Drive or Notion stays in sync.
                </span>
              </Link>
            </div>
          </section>
        </>
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

      <LiveProgress stillWorking={overview.runningJobs > 0} />

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
            There is no rush — leave these and they will be waiting on Home.
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
            Still reading. This updates on its own.
          </Callout>
        </div>
      ) : null}
    </AppShell>
  );
}
