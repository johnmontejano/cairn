import Link from 'next/link';
import { PRODUCT } from '@cairn/config';
import { Callout, SkipLink } from '@cairn/ui';
import { Wordmark } from '@/components/chrome';

export const metadata = { title: 'Privacy' };

/**
 * The public privacy policy.
 *
 * Deliberately outside any auth check — Google's OAuth verification review
 * requires this to be reachable, on this same domain, without signing in.
 * Content lives in `docs/PRIVACY_POLICY.md`; this page is that same text in
 * Cairn's own design system rather than raw Markdown, so a visitor gets the
 * product's normal typography instead of a GitHub-rendered file.
 *
 * When the source document changes, mirror the change here — there is no
 * build step that generates one from the other, so a divergence is a person
 * forgetting to update this file, not a system that can drift on its own.
 */
export default function PrivacyPage() {
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

      <main id="main">
        <div className="cairn-landing__inner" style={{ maxWidth: '48rem' }}>
          <h1 className="cairn-page-title">Privacy Policy</h1>
          <p className="cairn-meta">Last updated: 2026-08-01 · Operator: Cairn (John M.)</p>

          <p style={{ marginTop: '1.5rem' }}>
            Cairn stores things you want your AI tools to remember, so you stop explaining yourself
            over and over. This policy says exactly what it holds, who else can see it, and what you
            can remove.
          </p>
          <p>
            It is written to be read. Where something is a genuine weakness, it is named rather than
            phrased around.
          </p>

          <h2 className="cairn-section-title">What Cairn holds</h2>
          <p>
            <strong>Things you chose to save.</strong> Every memory reaches Cairn as a proposal and
            is saved only after you keep it. Nothing is saved from a source without you reviewing it
            first.
          </p>
          <p>
            <strong>The documents those memories came from.</strong> Cairn keeps the original text
            so that every answer can show the exact sentence it came from. These are encrypted
            before they are written to disk.
          </p>
          <p>
            <strong>Your email address</strong>, to sign you in.
          </p>
          <p>
            <strong>Records of activity</strong> — that a memory was approved, a source connected,
            an AI tool granted access. These hold no memory content.
          </p>
          <p>
            <strong>Nothing else.</strong> Cairn has no advertising, no analytics of your content,
            and no tracking across other sites.
          </p>

          <h2 className="cairn-section-title">Who else receives it</h2>
          <p>
            Cairn is not a single company holding your data alone. Each service below receives a
            specific slice.
          </p>
          <div className="cairn-table-wrap">
            <table className="cairn-table">
              <caption className="cairn-visually-hidden">Who receives what</caption>
              <thead>
                <tr>
                  <th scope="col">Who</th>
                  <th scope="col">What they receive</th>
                  <th scope="col">Can they read your text?</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Vercel (hosting)</th>
                  <td>Every request while it is being handled</td>
                  <td>Yes — this is where Cairn itself runs</td>
                </tr>
                <tr>
                  <th scope="row">Supabase (database, US East)</th>
                  <td>Encrypted memory and documents, plus metadata</td>
                  <td>No, except the items named below</td>
                </tr>
                <tr>
                  <th scope="row">Supabase Storage</th>
                  <td>Encrypted copies of original documents</td>
                  <td>No</td>
                </tr>
                <tr>
                  <th scope="row">WorkOS (sign-in)</th>
                  <td>Your email address and name</td>
                  <td>Identity only — never your memory</td>
                </tr>
                <tr>
                  <th scope="row">Google (Gmail, Calendar, Drive)</th>
                  <td>Only a request for what you connected</td>
                  <td>It is their data already; Cairn reads it</td>
                </tr>
                <tr>
                  <th scope="row">Sentry (errors, optional)</th>
                  <td>Error type and message</td>
                  <td>No content</td>
                </tr>
                <tr>
                  <th scope="row">AI tools you connect</th>
                  <td>Only the memory they look up, with citations</td>
                  <td>Yes — see below</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3 className="cairn-card__title" style={{ marginTop: '1.75rem' }}>
            If an AI model is turned on
          </h3>
          <p>
            This deployment runs with no external model at all: extraction, search, and answering
            all happen inside the application. No document text, memory text, or question you ask
            ever leaves this service to reach any AI provider.
          </p>
          <p>
            If that ever changes, this section will be updated first, and the table above will name
            exactly who receives what.
          </p>

          <h3 className="cairn-card__title" style={{ marginTop: '1.75rem' }}>
            AI tools you connect
          </h3>
          <p>
            When you connect Claude, Cursor, ChatGPT, or another tool, it can look things up in the
            memory you have saved. What it retrieves goes to that company, and from that moment{' '}
            <strong>their</strong> terms apply to it, not this policy. That is true of every AI
            tool, and it is why nothing is shared until you decide.
          </p>
          <p>
            A connected tool can never change or delete your memory, and can never see anything
            still waiting for your review. You can turn any connection off at any time, and it stops
            working immediately.
          </p>

          <h2 className="cairn-section-title">What is not encrypted, and why</h2>
          <p>
            Your memory and documents are encrypted before they are stored. Some things cannot be,
            because a feature depends on reading them:
          </p>
          <ul>
            <li>
              <strong>Topic tags, types, and dates</strong> — filtering and sorting need them. These
              disclose subject matter and when you were active.
            </li>
            <li>
              <strong>Document titles and web addresses</strong> — a citation you cannot read is not
              a citation.
            </li>
            <li>
              <strong>Search embeddings</strong> — the numeric representations used to find relevant
              memory. These are stored unencrypted because the search index must compare them, and
              they are <strong>partially reversible</strong>: someone with direct access to the
              database could recover an approximation of your memory&rsquo;s meaning from them. This
              is the weakest point in the design and it is named here deliberately rather than left
              out.
            </li>
          </ul>

          <h2 className="cairn-section-title">Google user data</h2>
          <p>
            Cairn&rsquo;s use of information received from Google APIs adheres to the{' '}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noreferrer noopener"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
          <p>Specifically:</p>
          <ul>
            <li>Gmail and Calendar data is read only to propose memories for you to review.</li>
            <li>
              It is never sold, and never transferred to anyone except as necessary to provide the
              feature you asked for.
            </li>
            <li>It is never used for advertising.</li>
            <li>It is not used to train any general-purpose AI model.</li>
            <li>
              No human reads it, except where you explicitly ask for support and grant access, or
              where the law requires it.
            </li>
          </ul>
          <p>
            Disconnecting Google in Cairn destroys the stored credential immediately. You can also
            revoke access at{' '}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noreferrer noopener"
            >
              myaccount.google.com/permissions
            </a>
            .
          </p>

          <h2 className="cairn-section-title">How long it is kept</h2>
          <div className="cairn-table-wrap">
            <table className="cairn-table">
              <caption className="cairn-visually-hidden">Retention periods</caption>
              <thead>
                <tr>
                  <th scope="col">What</th>
                  <th scope="col">Kept for</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Memory you saved</th>
                  <td>Until you delete it</td>
                </tr>
                <tr>
                  <th scope="row">Original documents</th>
                  <td>
                    90 days, then the original is dropped — only the memory it produced remains
                  </td>
                </tr>
                <tr>
                  <th scope="row">Activity records</th>
                  <td>12 months, then removed</td>
                </tr>
                <tr>
                  <th scope="row">Sign-in sessions</th>
                  <td>30 days, or until you sign out</td>
                </tr>
                <tr>
                  <th scope="row">Source credentials</th>
                  <td>Destroyed the moment you disconnect</td>
                </tr>
                <tr>
                  <th scope="row">Backups you download</th>
                  <td>Only by you — Cairn never keeps them</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h2 className="cairn-section-title">What you can do</h2>
          <p>
            <strong>Export everything</strong>, as ordinary Markdown files, in one click. No
            request, no waiting.
          </p>
          <p>
            <strong>Download an encrypted backup</strong>, locked with a passphrase only you know.
            Cairn cannot open it. If you lose the passphrase, nobody can.
          </p>
          <p>
            <strong>Delete everything.</strong> Deleting your workspace removes memory, documents,
            sources, connections, connected AI tools, activity records, and finally the key that
            everything was encrypted with. You get a report naming each category and how many rows
            were removed.
          </p>
          <p>
            Deletion is <strong>immediate</strong>. There is no grace period and no undo. If you
            want a copy first, download a backup or export before deleting.
          </p>
          <p>
            Three things deletion honestly cannot reach, and Cairn says so rather than implying
            otherwise:
          </p>
          <ul>
            <li>Files you exported or downloaded yourself.</li>
            <li>Anything an AI tool already stored in its own history.</li>
            <li>The database provider&rsquo;s own backups, for their retention window.</li>
          </ul>

          <h2 className="cairn-section-title">What Cairn does not claim</h2>
          <Callout tone="warn" title="No independent security review">
            Cairn has had no independent security review. It has no certification, no SOC 2 report,
            and no compliance audit. The design is documented in the open — see the threat model and
            privacy matrix — precisely so the claims can be checked rather than taken on trust.
          </Callout>
          <p style={{ marginTop: '1rem' }}>
            If that is not enough assurance for the data you were thinking of putting in, do not put
            it in yet. That is a reasonable decision and this policy would rather say so than talk
            you past it.
          </p>

          <h2 className="cairn-section-title">Changes, and getting in touch</h2>
          <p>
            Material changes will be shown in the app before they take effect, not published
            quietly.
          </p>
          <p>
            Questions or deletion requests:{' '}
            <a href="mailto:johnmontejano2@gmail.com">johnmontejano2@gmail.com</a>.
          </p>

          <footer className="cairn-landing-footer">
            <span>
              {PRODUCT.name} — {PRODUCT.tagline}
            </span>
            <Link href="/">Back home</Link>
          </footer>
        </div>
      </main>
    </div>
  );
}
