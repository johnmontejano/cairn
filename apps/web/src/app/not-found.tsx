import Link from 'next/link';
import { PRODUCT } from '@cairn/config';
import { SkipLink } from '@cairn/ui';
import { Wordmark } from '@/components/chrome';

export const metadata = { title: 'Not found' };

/**
 * Rendered per request, for the same reason `/privacy` is.
 *
 * `proxy.ts` admits scripts by per-request nonce and pairs that with
 * `strict-dynamic`, which switches off host allow-listing — so a prerendered
 * page carries a build-time nonce that can never match the header on a later
 * request, and every script on it is blocked. This was the last statically
 * prerendered route in the app and so the last one shipping without
 * JavaScript. Without a file of its own there was nowhere to say this: the
 * framework's built-in 404 has no route segment config to set.
 *
 * The page it replaces was also the one screen in the product that had never
 * been designed — unstyled framework default text on a white ground, in a
 * product that is committed dark everywhere else. Someone who mistypes a URL
 * should still be somewhere recognisable.
 */
export const dynamic = 'force-dynamic';

export default function NotFound() {
  return (
    <div className="cairn-shell cairn-landing">
      <SkipLink />
      <header className="cairn-header">
        <div className="cairn-header__inner">
          <Link href="/" aria-label={`${PRODUCT.name} home`}>
            <Wordmark />
          </Link>
        </div>
      </header>

      {/* `cairn-landing__inner` carries no vertical rhythm of its own — on the
          landing each section supplies its own — so a page this sparse has to
          say where it sits, or it hangs off the underside of the header with
          an empty screen below it. Centred in what is left after the header
          rather than top-aligned, since there is nothing here to scroll to. */}
      <main
        id="main"
        style={{
          minHeight: 'calc(100vh - 6rem)',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <div className="cairn-landing__inner" style={{ maxWidth: '34rem' }}>
          <h1 className="cairn-page-title">That page is not here</h1>
          <p style={{ marginTop: '1rem' }}>
            The address may be mistyped, or it may be something that has since moved. Nothing is
            wrong with your memory — this is only a missing page.
          </p>
          <div className="cairn-row" style={{ marginTop: '1.75rem', gap: '0.75rem' }}>
            <Link href="/home" className="cairn-button cairn-button--primary">
              Go to your memory
            </Link>
            <Link href="/" className="cairn-button cairn-button--quiet">
              Back to the start
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
