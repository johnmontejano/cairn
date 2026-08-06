import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Spectral } from 'next/font/google';
import { PRODUCT } from '@cairn/config';
import { Badge, Callout, SkipLink } from '@cairn/ui';
import { getServices } from '@cairn/ingestion';
import { Wordmark } from '@/components/chrome';
import { SignInFlow } from '@/components/forms';
import { HeroScene } from '@/components/hero-scene';
import { LandingMotion } from '@/components/landing-motion';
import { continueSignIn, hasSession } from '@/server/actions';
import { safeReturnPath } from '@/server/auth';

// Reads the session cookie and the live provider configuration, so it must be
// rendered per request rather than baked into the build.
export const dynamic = 'force-dynamic';

/**
 * The landing display face. Spectral's chiseled, flared terminals read as
 * letters cut into stone — the one face on the page with a point of view,
 * scoped to the landing so the app past sign-in keeps its quiet system stack.
 * Self-hosted by next/font at build time; nothing is fetched at runtime, so
 * the CSP stays untouched.
 */
const spectral = Spectral({
  weight: ['500', '600'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--cairn-font-display-face',
});

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
  searchParams: Promise<{ deleted?: string; error?: string; next?: string }>;
}) {
  const params = await searchParams;
  // `next` is how a consent screen sends someone here and gets them back. It is
  // narrowed to a path on this site before it is used or echoed into the form.
  const returnTo = safeReturnPath(params.next ?? null);
  if (await hasSession()) redirect(returnTo ?? '/home');
  const services = await getServices();
  const demoMode = services.config.providers.auth.state !== 'ready';

  return (
    <div className={`cairn-shell cairn-landing ${spectral.variable}`}>
      {/*
        THESIS: A night assembly — scattered context becomes one deliberately
        placed stack as the visitor scrolls. Refuses the category's grid of
        same-size feature cards.
        OWN-WORLD: committed-dark cool ground (#10141a), one glowing indigo
        accent, Spectral serif display in off-white, hairline borders, the 3D
        five-stone cairn as the page's protagonist. System sans body.
        STORY: someone tired of re-explaining their context to every AI tool
        watches their scattered pieces assemble into one trustworthy stack,
        believes it because every answer shows receipts, and signs in by email.
        FIRST VIEWPORT: full-height hero; left — eyebrow, the one h1, lede,
        sign-in card (the primary action, on screen, not behind a link);
        right — the stones adrift with the proof card at their foot; a quiet
        scroll cue below.
        FORM: elevation of the incumbent Cairn world (established identity
        inherited; no concept tournament). Motion grammar: one scroll-driven
        assembly plus rise-from-dark reveals, reduced-motion safe.
      */}
      <SkipLink />
      <LandingMotion />
      <header className="cairn-header cairn-header--landing" data-landing-header>
        <div className="cairn-header__inner">
          <Wordmark />
          <nav aria-label="Landing" className="cairn-landing-nav">
            <a href="#how" className="cairn-landing-nav__link">
              How it works
            </a>
            <a href="#receipts" className="cairn-landing-nav__link">
              Receipts
            </a>
            <a href="#signin" className="cairn-landing-nav__cta">
              Sign in
            </a>
          </nav>
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
            <div className="cairn-hero__copy">
              <span className="cairn-eyebrow" data-hero-rise>
                {demoMode ? 'Running on this computer' : 'Private by default'}
              </span>

              <h1 className="cairn-display" data-hero-rise>
                Stop telling every AI tool <em>the same things</em> about your work.
              </h1>

              <p className="cairn-hero__lede" data-hero-rise>
                {PRODUCT.description}
              </p>

              <div className="cairn-hero__card" id="signin" data-hero-rise>
                <h2 className="cairn-hero__card-title">Sign in</h2>
                <SignInFlow action={continueSignIn} demoMode={demoMode} next={returnTo} />
              </div>

              <p className="cairn-hero__note" data-hero-rise>
                {demoMode
                  ? 'No account is created anywhere else. This copy runs entirely on this machine.'
                  : 'No password to remember. We send a short code instead.'}
              </p>
            </div>

            <HeroScene />
          </section>

          <p className="cairn-scroll-cue" aria-hidden="true" data-hero-rise>
            <span className="cairn-scroll-cue__line" />
            Scroll — the stones find their place
          </p>
        </div>

        <div className="cairn-landing__inner">
          <section
            className="cairn-landing-section cairn-landing-section--split"
            aria-labelledby="how"
            id="how"
          >
            <div className="cairn-landing-section__intro">
              <h2 id="how-title" className="cairn-landing-section__title" data-reveal>
                Three steps, then it gets out of your way
              </h2>
              <p className="cairn-landing-section__lede" data-reveal>
                There is nothing to configure and nothing to learn first. You can be looking at your
                own memory in about a minute.
              </p>
            </div>
            <ol className="cairn-trail">
              {STEPS.map((step, index) => (
                <li className="cairn-trail__step" key={step.title} data-reveal>
                  <span className="cairn-trail__marker" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="cairn-trail__title">{step.title}</h3>
                    <p className="cairn-trail__body">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="cairn-landing-section" aria-labelledby="receipts" id="receipts">
            <div className="cairn-proof">
              <div>
                <h2 id="receipts-title" className="cairn-landing-section__title" data-reveal>
                  Every answer shows its receipts
                </h2>
                <p
                  className="cairn-landing-section__lede"
                  style={{ marginBottom: '1rem' }}
                  data-reveal
                >
                  A confident answer you cannot check is worse than no answer. So every statement
                  points back to the exact sentence it came from, in the document it came from, on
                  the day it arrived.
                </p>
                <p style={{ color: 'var(--cairn-ink-muted)', margin: 0 }} data-reveal>
                  The same is true of every saved memory: open “Why do you know this?” on any card
                  and the original words are right there.
                </p>
              </div>

              <div className="cairn-proof__demo" data-reveal>
                <span className="cairn-example-tag">Example</span>
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
            <h2 id="control" className="cairn-landing-section__title" data-reveal>
              You keep hold of it
            </h2>
            <p className="cairn-landing-section__lede" data-reveal>
              This is where a lot of your working life ends up. That deserves saying plainly rather
              than in a policy nobody reads.
            </p>
            <ul className="cairn-pillars">
              {PILLARS.map((pillar) => (
                <li key={pillar.title} data-reveal>
                  <h3 className="cairn-pillar__title">{pillar.title}</h3>
                  <p className="cairn-pillar__body">{pillar.body}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="cairn-landing-section" aria-labelledby="tools">
            <h2 id="tools" className="cairn-landing-section__title" data-reveal>
              Bring the AI you already use
            </h2>
            <p className="cairn-landing-section__lede" data-reveal>
              Cairn is not another chat window to live in. The tools you already work in can look
              things up here — with your say-so, and never more than you chose to keep.
            </p>
            <div className="cairn-row" style={{ marginBottom: '1.5rem' }} data-reveal>
              {['Claude', 'Claude Code', 'ChatGPT', 'Cursor', 'VS Code'].map((name) => (
                <Badge key={name} tone="neutral">
                  {name}
                </Badge>
              ))}
            </div>
            <ol className="cairn-trail cairn-trail--pair">
              <li className="cairn-trail__step" data-reveal>
                <span className="cairn-trail__marker" aria-hidden="true">
                  1
                </span>
                <div>
                  <h3 className="cairn-trail__title">Save a few things first</h3>
                  <p className="cairn-trail__body">
                    Add the background you keep repeating and keep what is right. A connected tool
                    can only ever see what you chose to keep.
                  </p>
                </div>
              </li>
              <li className="cairn-trail__step" data-reveal>
                <span className="cairn-trail__marker" aria-hidden="true">
                  2
                </span>
                <div>
                  <h3 className="cairn-trail__title">Connect your tool once</h3>
                  <p className="cairn-trail__body">
                    Approve it here, and from then on it can look things up on its own. Turning it
                    off takes effect immediately.
                  </p>
                </div>
              </li>
            </ol>
          </section>

          <section className="cairn-close" aria-label="Closing">
            <p className="cairn-close__line" data-reveal>
              Small stones, <em>deliberately placed.</em>
            </p>
            <p className="cairn-close__sub" data-reveal>
              Say it once. Every tool you trust can find it.
            </p>
            <a href="#signin" className="cairn-close__cta" data-reveal>
              Start your cairn
            </a>
          </section>

          <footer className="cairn-landing-footer">
            <span>
              {demoMode
                ? 'Running in demo mode on this computer. No email is sent and nothing leaves this machine.'
                : 'Your memory is private to your account.'}
            </span>
            <span>
              {PRODUCT.name} — {PRODUCT.tagline} · <Link href="/privacy">Privacy</Link>
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
