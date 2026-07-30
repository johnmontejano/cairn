import { redirect } from 'next/navigation';
import { PRODUCT } from '@cairn/config';
import { Callout, SkipLink } from '@cairn/ui';
import { getServices } from '@cairn/ingestion';
import { Wordmark } from '@/components/chrome';
import { SignInFlow } from '@/components/forms';
import { HeroArt } from '@/components/hero-art';
import { continueSignIn, hasSession } from '@/server/actions';

// Reads the session cookie and the live provider configuration, so it must be
// rendered per request rather than baked into the build.
export const dynamic = 'force-dynamic';

const STEPS = [
  {
    title: 'Add whatever you keep repeating',
    body: 'Paste a note, drop in a document, or point at a page. Nothing needs to be tidy first.',
  },
  {
    title: 'Look at what it found',
    body: 'Each thing worth remembering arrives as a card with the sentence it came from. Keep it, reword it, or throw it away.',
  },
  {
    title: 'Stop explaining yourself',
    body: 'Ask questions here, or let a tool you already use look things up. You decide which, and you can change your mind.',
  },
];

const PILLARS = [
  {
    title: 'It stays yours',
    body: 'Everything you keep is ordinary Markdown you can download in one click, and delete in one step. No export request, no waiting.',
  },
  {
    title: 'Nothing is saved behind your back',
    body: 'Every memory waits for you to keep it. Nothing reaches an AI tool until you connect one, and turning it off takes effect immediately.',
  },
  {
    title: 'It will tell you when it does not know',
    body: 'Answers can only use what you saved. When there is not enough, it says so instead of guessing.',
  },
];

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string; error?: string }>;
}) {
  if (await hasSession()) redirect('/home');
  const services = await getServices();
  const params = await searchParams;
  const demoMode = services.config.providers.auth.state !== 'ready';

  return (
    <div className="cairn-shell cairn-landing">
      <SkipLink />
      <header className="cairn-header">
        <div className="cairn-header__inner">
          <Wordmark />
        </div>
      </header>

      <main id="main">
        <div className="cairn-landing__inner">
          {params.deleted ? (
            <div style={{ paddingTop: '1.5rem' }}>
              <Callout tone="good" title="Everything was deleted">
                Your memory, documents, connections and keys have been removed. Anything you
                exported yourself is unaffected.
              </Callout>
            </div>
          ) : null}

          {/* Hosted sign-in returns here on refusal or an expired code. Without
              this the person lands on an ordinary sign-in page with no idea why
              the round trip failed. */}
          {params.error ? (
            <div style={{ paddingTop: '1.5rem' }}>
              <Callout tone="warn" title="Sign-in did not finish" live="polite">
                {params.error}
              </Callout>
            </div>
          ) : null}

          <section className="cairn-hero">
            <div>
              <span className="cairn-eyebrow">
                {demoMode ? 'Running on this computer' : 'Private by default'}
              </span>

              <h1 className="cairn-display">
                Stop telling every AI tool <em>the same things</em> about your work.
              </h1>

              <p className="cairn-hero__lede">{PRODUCT.description}</p>

              <div className="cairn-hero__card">
                <h2 className="cairn-hero__card-title">Sign in</h2>
                <SignInFlow action={continueSignIn} demoMode={demoMode} />
              </div>

              <p className="cairn-hero__note">
                {demoMode
                  ? 'No account is created anywhere else. This copy runs entirely on this machine.'
                  : 'No password to remember. We send a short code instead.'}
              </p>
            </div>

            <HeroArt />
          </section>
        </div>

        <div className="cairn-landing__inner">
          <section className="cairn-landing-section" aria-labelledby="how">
            <h2 id="how" className="cairn-landing-section__title">
              Three steps, then it gets out of your way
            </h2>
            <p className="cairn-landing-section__lede">
              There is nothing to configure and nothing to learn first. You can be looking at your
              own memory in about a minute.
            </p>
            <ol className="cairn-steps">
              {STEPS.map((step) => (
                <li className="cairn-step" key={step.title}>
                  <h3 className="cairn-step__title">{step.title}</h3>
                  <p className="cairn-step__body">{step.body}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="cairn-landing-section" aria-labelledby="receipts">
            <div className="cairn-proof">
              <div>
                <h2 id="receipts" className="cairn-landing-section__title">
                  Every answer shows its receipts
                </h2>
                <p className="cairn-landing-section__lede" style={{ marginBottom: '1rem' }}>
                  A confident answer you cannot check is worse than no answer. So every statement
                  points back to the exact sentence it came from, in the document it came from, on
                  the day it arrived.
                </p>
                <p style={{ color: 'var(--cairn-ink-muted)', margin: 0 }}>
                  The same is true of every saved memory: open “Why do you know this?” on any card
                  and the original words are right there.
                </p>
              </div>

              <div className="cairn-proof__demo">
                <p className="cairn-proof__question">Which lease did we decide to sign?</p>
                <p className="cairn-proof__answer">
                  You signed the Mill Street lease rather than the unit by the station.
                  <span className="cairn-proof__cite">[1]</span> The station unit had more footfall
                  but nearly double the rent.
                  <span className="cairn-proof__cite">[2]</span>
                </p>
                <div className="cairn-proof__evidence">
                  <strong>[1]</strong> Planning notes · characters 512–604
                  <p>
                    “We decided to sign the Mill Street lease rather than the unit by the station.”
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="cairn-landing-section" aria-labelledby="control">
            <h2 id="control" className="cairn-landing-section__title">
              You keep hold of it
            </h2>
            <p className="cairn-landing-section__lede">
              This is where a lot of your working life ends up. That deserves saying plainly rather
              than in a policy nobody reads.
            </p>
            <ul className="cairn-pillars">
              {PILLARS.map((pillar) => (
                <li key={pillar.title}>
                  <h3 className="cairn-pillar__title">{pillar.title}</h3>
                  <p className="cairn-pillar__body">{pillar.body}</p>
                </li>
              ))}
            </ul>
          </section>

          <footer className="cairn-landing-footer">
            <span>
              {demoMode
                ? 'Running in demo mode on this computer. No email is sent and nothing leaves this machine.'
                : 'Your memory is private to your account.'}
            </span>
            <span>
              {PRODUCT.name} — {PRODUCT.tagline}
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
