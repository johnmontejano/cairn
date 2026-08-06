import Link from 'next/link';
import { PRODUCT } from '@cairn/config';
import { Callout, Card, Field, TextInput } from '@cairn/ui';
import { AppShell } from '@/components/chrome';
import { ActionForm, SubmitButton } from '@/components/forms';
import { restoreFromBackup } from '@/server/actions';
import { csrfToken, requireContext } from '@/server/context';
import { loadExports } from '@/server/views';

export const metadata = { title: 'Your copies' };
export const dynamic = 'force-dynamic';

/**
 * Getting your memory out, and getting it back.
 *
 * These four things — download, back up, see what you have backed up, restore —
 * were four sections buried two screens down inside Settings, between a budget
 * cap and a data-processing table. They are the concrete form of the promise
 * the landing page leads with ("it stays yours"), and a promise you have to go
 * looking for in a settings page is not much of a promise. They get their own
 * destination.
 *
 * Nothing about how any of it works changed: the same `/api/export` and
 * `/api/backup` endpoints, the same `restoreFromBackup` action, the same
 * passphrase rules. Only where a person finds them.
 *
 * Not added to the top navigation on purpose. That bar is held at five entries
 * (see `chrome.tsx`) so that connecting a tool stays the obvious choice rather
 * than one word among many; this page is reached from Settings and from the
 * footer's "Where your data goes", which is where someone worried about their
 * data is already looking.
 */
export default async function ExportsPage() {
  const context = await requireContext();
  const csrf = await csrfToken();
  const view = await loadExports(context);
  const projectId = context.project.id;

  const nothingToExport = view.memoryCount === 0;

  return (
    <AppShell current="/exports" email={context.email}>
      <h1 className="cairn-page-title">Your copies</h1>
      <p className="cairn-page-lede">
        Everything you have kept, in formats that outlive {PRODUCT.name}. Take a copy whenever you
        like — there is no request to make and nothing to wait for.
      </p>

      {/* ------------------------------ download ----------------------------- */}
      <section aria-labelledby="download" style={{ marginBottom: '2.5rem' }}>
        <h2 id="download" className="cairn-section-title">
          Take a copy
        </h2>
        <div className="cairn-grid">
          <Card>
            <h3 className="cairn-card__title">Readable files</h3>
            <p className="cairn-card__description">
              A zip of ordinary Markdown. Open it in any text editor, keep it in any folder. Nothing
              about these files needs {PRODUCT.name} to read them.
            </p>
            {nothingToExport ? (
              /* An export of nothing is a confusing empty zip rather than an
                 error, so the action is withheld and says why, instead of
                 handing over a file that looks like data loss. */
              <Callout tone="info" title="Nothing kept yet">
                Once you keep your first memory it will appear here.{' '}
                <Link href="/welcome">Add something to remember</Link>.
              </Callout>
            ) : (
              <div style={{ marginTop: '0.875rem' }}>
                <a
                  className="cairn-button cairn-button--primary"
                  href={`/api/export?projectId=${projectId}`}
                  download
                >
                  Download {view.memoryCount}{' '}
                  {view.memoryCount === 1 ? 'memory' : 'memories'}
                </a>
              </div>
            )}
          </Card>

          <Card>
            <h3 className="cairn-card__title">A backup you can restore</h3>
            <p className="cairn-card__description">
              One encrypted file holding your memory, its history, and the fingerprints needed to
              prove it came back intact.
            </p>
            <Callout tone="warn" title="Choose the passphrase carefully">
              The file is locked with a passphrase you pick. Nobody — including whoever runs this
              app — can open it without that passphrase. If you lose it, the backup is gone.
            </Callout>
            <form
              method="post"
              action="/api/backup"
              className="cairn-stack cairn-stack--md"
              style={{ marginTop: '0.875rem' }}
            >
              <input type="hidden" name="csrf" value={csrf} />
              <input type="hidden" name="projectId" value={projectId} />
              <Field
                id="backup-pass"
                label="Backup passphrase"
                hint="At least 10 characters. Write it down somewhere safe."
                required
              >
                {({ id, describedBy }) => (
                  <TextInput
                    id={id}
                    name="passphrase"
                    type="password"
                    minLength={10}
                    required
                    autoComplete="new-password"
                    aria-describedby={describedBy}
                  />
                )}
              </Field>
              <div>
                <button type="submit" className="cairn-button cairn-button--secondary">
                  Download backup
                </button>
              </div>
            </form>
          </Card>
        </div>
      </section>

      {/* --------------------------- backup history -------------------------- */}
      <section aria-labelledby="backup-history" style={{ marginBottom: '2.5rem' }}>
        <h2 id="backup-history" className="cairn-section-title">
          Backups you have made
        </h2>
        {view.backups.length === 0 ? (
          <Card>
            {/* Wording note: the restore drill's e2e matcher looks for
                /Restored|Checked:/ as the outcome of a real restore, so this
                sentence must not contain those words while it sits on the
                same page as that outcome. */}
            <p className="cairn-card__description" style={{ margin: 0 }}>
              No backups yet. When you make one it is listed here — the date, the size, and a short
              fingerprint for proving a later copy came back intact.
            </p>
          </Card>
        ) : (
          <Card>
            <table className="cairn-table">
              <caption className="cairn-visually-hidden">
                Backups you have made, most recent first
              </caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Size</th>
                  <th scope="col">Fingerprint</th>
                </tr>
              </thead>
              <tbody>
                {view.backups.map((backup) => (
                  <tr key={backup.id}>
                    <th scope="row">
                      {backup.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                    </th>
                    <td>{Math.max(1, Math.round(backup.byteSize / 1024))} KB</td>
                    <td>
                      <code className="cairn-code">{backup.contentHash.slice(7, 19)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="cairn-card__description" style={{ marginBottom: 0 }}>
              Only the size and fingerprint are recorded here. The backup file itself is never kept
              on the server — that is what makes the passphrase meaningful.
            </p>
          </Card>
        )}
      </section>

      {/* ------------------------------ restore ------------------------------ */}
      <section aria-labelledby="restore" style={{ marginBottom: '2.5rem' }}>
        <h2 id="restore" className="cairn-section-title">
          Restore from a backup
        </h2>
        <Card>
          <p className="cairn-card__description" style={{ marginTop: 0 }}>
            Lost your computer, or starting again somewhere else? Upload a backup file. Check it
            first if you want to see what is inside without changing anything.
          </p>
          <ActionForm
            action={restoreFromBackup}
            csrf={csrf}
            hidden={{ projectId }}
            className="cairn-stack cairn-stack--md"
          >
            <Field id="restore-file" label="Backup file" required>
              {({ id }) => (
                <input
                  id={id}
                  className="cairn-input"
                  type="file"
                  name="backup"
                  accept=".cairnbackup"
                  required
                />
              )}
            </Field>
            <Field id="restore-pass" label="Its passphrase" required>
              {({ id }) => (
                <TextInput id={id} name="passphrase" type="password" required autoComplete="off" />
              )}
            </Field>
            <label className="cairn-choice">
              <input type="checkbox" name="dryRun" defaultChecked />
              Just check it — do not change anything yet
            </label>
            <div>
              <SubmitButton busyLabel="Checking…">Continue</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </section>

      <p className="cairn-note">
        Deleting everything, budgets, and where your data goes live in{' '}
        <Link href="/settings">Settings</Link>.
      </p>
    </AppShell>
  );
}
