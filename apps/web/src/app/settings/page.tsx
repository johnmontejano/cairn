import { Badge, Callout, Card, Disclosure, Field, TextInput } from '@cairn/ui';
import { PRODUCT } from '@cairn/config';
import { AppShell } from '@/components/chrome';
import { ActionForm, ConfirmForm, SubmitButton } from '@/components/forms';
import { deleteEverything, restoreFromBackup, saveWorkspaceSettings } from '@/server/actions';
import { csrfToken, requireContext } from '@/server/context';
import { loadSettings } from '@/server/views';

export const metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const context = await requireContext();
  const csrf = await csrfToken();
  const view = await loadSettings(context);
  const { providers, database, mode } = context.services.config;
  const projectId = context.project.id;

  return (
    <AppShell current="/settings" email={context.email}>
      <h1 className="cairn-page-title">Settings</h1>
      <p className="cairn-page-lede">
        Your memory, your copies, your decision to delete it. Everything on this page is meant to be
        readable without knowing how any of it works.
      </p>

      {/* ------------------------------ export ------------------------------ */}
      <section aria-labelledby="your-copy" style={{ marginBottom: '2.5rem' }}>
        <h2 id="your-copy" className="cairn-section-title">
          Keep your own copy
        </h2>
        <div className="cairn-grid">
          <Card>
            <h3 className="cairn-card__title">Download as readable files</h3>
            <p className="cairn-card__description">
              A zip of ordinary Markdown files. Open them in any text editor. Nothing about them
              needs {PRODUCT.name}.
            </p>
            <div style={{ marginTop: '0.875rem' }}>
              <a
                className="cairn-button cairn-button--primary"
                href={`/api/export?projectId=${projectId}`}
                download
              >
                Download {view.memoryCount} memories
              </a>
            </div>
          </Card>

          <Card>
            <h3 className="cairn-card__title">Make a backup you can restore</h3>
            <p className="cairn-card__description">
              A single encrypted file containing your memory, its history, and the fingerprints
              needed to prove it came back intact.
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

        {view.backups.length > 0 ? (
          <Disclosure summary={`Backups you have made (${view.backups.length})`}>
            <table className="cairn-table">
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
            <p style={{ marginBottom: 0 }}>
              Only the size and fingerprint are recorded here. The backup file itself is never kept
              on the server — that is what makes the passphrase meaningful.
            </p>
          </Disclosure>
        ) : null}
      </section>

      {/* ------------------------------ restore ----------------------------- */}
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

      {/* --------------------------- where data goes ------------------------ */}
      <section
        aria-labelledby="where-your-data-goes"
        id="where-your-data-goes"
        style={{ marginBottom: '2.5rem' }}
      >
        <h2 id="where-your-data-goes" className="cairn-section-title">
          Where your data goes
        </h2>
        <Card>
          <table className="cairn-table">
            <caption className="cairn-visually-hidden">Which service handles which part</caption>
            <thead>
              <tr>
                <th scope="col">What</th>
                <th scope="col">Handled by</th>
                <th scope="col">Sees your text?</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Your memory and documents</th>
                <td>
                  {database.driver === 'pglite'
                    ? 'A database file on this computer'
                    : 'The configured PostgreSQL database'}
                </td>
                <td>Encrypted before it is stored</td>
              </tr>
              <tr>
                <th scope="row">Signing in</th>
                <td>{providers.auth.detail}</td>
                <td>Your email address only</td>
              </tr>
              <tr>
                <th scope="row">Finding what to remember</th>
                <td>{providers.ai.detail}</td>
                <td>
                  {providers.ai.state === 'ready'
                    ? 'Yes — document text is sent to that provider'
                    : 'No — nothing leaves this machine'}
                </td>
              </tr>
              <tr>
                <th scope="row">Stored files</th>
                <td>{providers.storage.detail}</td>
                <td>Encrypted before it is stored</td>
              </tr>
              <tr>
                <th scope="row">Connected AI tools</th>
                <td>Whichever tools you connect</td>
                <td>Only the saved memory they look up</td>
              </tr>
            </tbody>
          </table>

          <Callout tone="info" title="What is and is not promised">
            <p style={{ marginTop: 0 }}>
              Your memory, documents, and connection permissions are encrypted before being stored,
              and the key that unlocks them is not kept in the database.
            </p>
            <p style={{ marginBottom: 0 }}>
              This is <strong>not</strong> end-to-end encryption: while the app is working on your
              memory, it can read it. That is what lets it search and answer. There is no claim of
              SOC 2, GDPR compliance, or zero retention here.{' '}
              <a href="https://github.com" rel="noreferrer noopener">
                The threat model document
              </a>{' '}
              in this project spells out exactly what is and is not protected.
            </p>
          </Callout>
        </Card>
      </section>

      {/* ------------------------------- costs ------------------------------ */}
      <section aria-labelledby="costs" style={{ marginBottom: '2.5rem' }}>
        <h2 id="costs" className="cairn-section-title">
          Spending limit
        </h2>
        <Card>
          <p className="cairn-card__description" style={{ marginTop: 0 }}>
            {providers.ai.state === 'ready'
              ? 'Reading documents with a paid AI service costs money. This is the ceiling.'
              : 'Nothing here costs money right now: the built-in reader runs on this machine. This limit applies if a paid service is turned on later.'}
          </p>
          <p className="cairn-meta">
            <Badge
              tone={view.budget.blocked ? 'danger' : view.budget.overSoftLimit ? 'warn' : 'good'}
            >
              ${view.budget.spentUsd.toFixed(4)} of ${view.budget.budgetUsd.toFixed(2)} this month
            </Badge>
          </p>
          <ActionForm
            action={saveWorkspaceSettings}
            csrf={csrf}
            className="cairn-stack cairn-stack--md"
          >
            <Field id="budget" label="Monthly limit (US dollars)" required>
              {({ id }) => (
                <TextInput
                  id={id}
                  name="budget"
                  type="number"
                  min="0"
                  max="10000"
                  step="0.5"
                  defaultValue={String(view.settings.aiMonthlyBudgetUsd)}
                  required
                />
              )}
            </Field>
            <label className="cairn-choice">
              <input
                type="checkbox"
                name="hardLimit"
                defaultChecked={view.settings.aiHardLimitEnabled}
              />
              Stop reading new documents when the limit is reached
            </label>
            <label className="cairn-choice">
              <input
                type="checkbox"
                name="privacyMode"
                defaultChecked={view.settings.privacyMode}
              />
              Privacy mode — never send anything to an outside AI service, even if one is configured
            </label>
            <Field id="retention" label="Keep original documents for (days)">
              {({ id }) => (
                <TextInput
                  id={id}
                  name="retentionDays"
                  type="number"
                  min="1"
                  max="3650"
                  defaultValue={String(view.settings.retentionDaysRaw)}
                />
              )}
            </Field>
            <div>
              <SubmitButton busyLabel="Saving…">Save settings</SubmitButton>
            </div>
          </ActionForm>

          {view.usage.length > 0 ? (
            <Disclosure summary="What has been used so far">
              <table className="cairn-table">
                <thead>
                  <tr>
                    <th scope="col">Operation</th>
                    <th scope="col">Model</th>
                    <th scope="col">Times</th>
                    <th scope="col">Estimated cost</th>
                  </tr>
                </thead>
                <tbody>
                  {view.usage.map((row) => (
                    <tr key={`${row.operation}-${row.model}`}>
                      <th scope="row">{row.operation}</th>
                      <td>{row.model}</td>
                      <td>{row.calls}</td>
                      <td>${row.costUsd.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Disclosure>
          ) : null}
        </Card>
      </section>

      {/* ------------------------------ delete ------------------------------ */}
      <section aria-labelledby="delete">
        <h2 id="delete" className="cairn-section-title">
          Delete everything
        </h2>
        <Card>
          <p style={{ marginTop: 0 }}>
            This removes your {view.memoryCount} saved memories, {view.sourceCount} documents, every
            version of your history, your connections, and the key that could decrypt any of it.
          </p>
          <p style={{ color: 'var(--cairn-ink-muted)' }}>
            It cannot be undone. Files you downloaded yourself are unaffected, and anything an AI
            tool already stored in its own history stays with that tool.
          </p>
          <ConfirmForm action={deleteEverything} csrf={csrf} confirmLabel="Delete everything">
            <Field
              id="confirm-delete"
              label="Type “delete everything” to confirm"
              error={null}
              required
            >
              {({ id }) => <TextInput id={id} name="confirm" required autoComplete="off" />}
            </Field>
          </ConfirmForm>
        </Card>
      </section>

      <p className="cairn-meta" style={{ marginTop: '2rem' }}>
        Running in {mode} mode · database: {database.driver} · reader: {providers.ai.detail}
      </p>
    </AppShell>
  );
}
