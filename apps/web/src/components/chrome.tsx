import Link from 'next/link';
import { PRODUCT } from '@cairn/config';
import { SkipLink } from '@cairn/ui';
import { signOut } from '@/server/actions';

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

const NAV = [
  { href: '/home', label: 'Home' },
  { href: '/sources', label: 'Sources' },
  { href: '/memory', label: 'Memory' },
  { href: '/ask', label: 'Ask' },
  { href: '/connections', label: 'Connected AIs' },
  { href: '/history', label: 'History' },
  { href: '/settings', label: 'Settings' },
];

export function AppShell({
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
          <form action={signOut}>
            <button type="submit" className="cairn-button cairn-button--quiet">
              Sign out
              <span className="cairn-visually-hidden"> ({email})</span>
            </button>
          </form>
        </div>
      </header>
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
