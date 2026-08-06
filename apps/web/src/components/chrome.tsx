import Link from 'next/link';
import { PRODUCT } from '@cairn/config';
import { Callout, SkipLink } from '@cairn/ui';
import { signOut } from '@/server/actions';
import { currentContext } from '@/server/context';
import { loadShellStatus, type ShellStatusView } from '@/server/views';

/** Three stacked stones. The only illustration in the product, used as the mark. */
export function Wordmark({ withName = true }: { withName?: boolean }) {
  return (
    <span className="cairn-wordmark">
      <svg
        className="cairn-wordmark__mark"
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      >
        <path d="M7.5 19.5h9" />
        <ellipse cx="12" cy="16.6" rx="6" ry="2.4" />
        <ellipse cx="12" cy="11.4" rx="4.4" ry="2.1" />
        <ellipse cx="12" cy="6.8" rx="2.9" ry="1.8" />
      </svg>
      {withName ? PRODUCT.name : null}
    </span>
  );
}

/**
 * Second position, and named after what a person is looking for.
 *
 * "Connected AIs" is the product's own phrase, not the visitor's: someone
 * scanning this row for Claude, ChatGPT or Codex does not stop on it, and
 * "Sources" sitting above it pulled them toward document import instead —
 * which is not what most people came for. "AI tools" is the phrase they
 * arrived with, and putting it directly after Home makes the thing the
 * product is actually for the first choice after "where am I".
 */
/**
 * Five sections, not seven.
 *
 * "Apps" rather than "Sources" because that is the word people use for the
 * things they connect; "Sources" was Cairn's internal name for the same idea
 * and made the section sound like a developer setting.
 *
 * Ask and History are gone from the bar but not from the product: asking now
 * lives at the top of Memory, where what you can ask about is already on
 * screen, and History is linked from Settings and from Home's own "last
 * change" line. Both routes still work, so nothing anyone bookmarked breaks.
 * Seven top-level choices made the one that matters — connecting a tool —
 * just another word in a row of words.
 */
const NAV = [
  { href: '/home', label: 'Home' },
  { href: '/connections', label: 'AI tools' },
  { href: '/sources', label: 'Apps' },
  { href: '/memory', label: 'Memory' },
  { href: '/settings', label: 'Settings' },
];

/**
 * Cheap, best-effort read of the two things `AppShell` shows before anyone
 * asks: still-running jobs and first-run setup standing. Uses `currentContext`
 * rather than `requireContext` deliberately — every page that renders
 * `AppShell` has already required a session (and redirected if there wasn't
 * one), so this never needs to redirect itself, and skipping that lets a
 * missing session here resolve to "show nothing" instead of a second
 * redirect from inside shared chrome. A read failure is swallowed the same
 * way: this status is a nice-to-have, not something a transient DB hiccup
 * should be allowed to take an entire page down for.
 */
async function loadShellStatusQuietly(): Promise<ShellStatusView | null> {
  const context = await currentContext();
  if (!context) return null;
  try {
    return await loadShellStatus(context);
  } catch (error) {
    console.error('loadShellStatus failed; hiding shell status for this request', error);
    return null;
  }
}

export async function AppShell({
  children,
  current,
  email,
  narrow = false,
}: {
  children: React.ReactNode;
  current: string;
  email: string;
  narrow?: boolean;
}) {
  const status = await loadShellStatusQuietly();

  return (
    <div className="cairn-shell">
      <SkipLink />
      <header className="cairn-header">
        <div className="cairn-header__inner">
          <Link href="/home" aria-label={`${PRODUCT.name} home`}>
            <Wordmark />
          </Link>
          <nav aria-label="Sections" className="cairn-nav">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="cairn-nav__link"
                aria-current={current === item.href ? 'page' : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="cairn-header__actions">
            {status && status.runningJobs > 0 ? (
              <span className="cairn-shell-status" role="status">
                <span className="cairn-shell-status__dot" aria-hidden="true" />
                Still organizing your memory
              </span>
            ) : null}
            <form action={signOut}>
              <button type="submit" className="cairn-button cairn-button--quiet">
                Sign out
                <span className="cairn-visually-hidden"> ({email})</span>
              </button>
            </form>
          </div>
        </div>
      </header>
      {/* Persistent, not one-time-dismissible: half-finished setup has no
          other signal pointing at it, so it stays visible on every page while
          it's genuinely blocked, rather than being dismissed once and
          forgotten. Driven by blockedBecause rather than `settled` --
          `setupSettledAt` is only ever written by the MCP-driven setup flow,
          so a workspace used entirely through the web app would otherwise
          never settle and this would nag forever regardless of how complete
          it actually is. blockedBecause is null exactly when there's nothing
          concrete left to do. */}
      {status && status.setup.blockedBecause ? (
        <div className="cairn-shell-banner">
          <Callout tone="info">
            {status.setup.blockedBecause} <Link href="/sources">Go to Sources</Link>.
          </Callout>
        </div>
      ) : null}
      <main id="main" className={narrow ? 'cairn-main cairn-main--narrow' : 'cairn-main'}>
        {children}
      </main>
      <footer className="cairn-footer">
        <div className="cairn-footer__inner">
          <span>Your memory stays private to you. Nothing is shared unless you connect it.</span>
          <Link href="/settings#where-your-data-goes">Where your data goes</Link>
        </div>
      </footer>
    </div>
  );
}
