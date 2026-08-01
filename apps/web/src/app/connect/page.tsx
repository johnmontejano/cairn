import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Callout, Card } from '@cairn/ui';
import { withTenant } from '@cairn/db';
import { AppShell } from '@/components/chrome';
import { ActionForm, SubmitButton } from '@/components/forms';
import { approveAiConnection, denyAiConnection } from '@/server/actions';
import { csrfToken, currentContext, workspaceName } from '@/server/context';
import { callbackUrl, validateAuthorizationRequest } from '@/server/oauth-request';

export const metadata = { title: 'Connect an AI tool' };
export const dynamic = 'force-dynamic';

/**
 * The authorization endpoint, which is also the only page in this flow a person
 * ever sees.
 *
 * Everything technical about OAuth is deliberately absent from the copy. The
 * person arrived here because they clicked "connect" inside another tool; the
 * only questions worth putting to them are which tool is asking, what it will
 * be able to see, and whether that is alright. Scopes, PKCE, and redirect URIs
 * are the machine's business and stay in the machine.
 */
export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') params.set(key, value);
  }

  const context = await currentContext();
  if (!context) {
    // Sign in first, then come straight back here rather than landing on the
    // home page having forgotten why they clicked. The request is carried in
    // the URL, so nothing is stored before the person has agreed to anything.
    redirect(`/?next=${encodeURIComponent(`/connect?${params.toString()}`)}`);
  }

  const csrf = await csrfToken();
  const name = await workspaceName(context);

  const validated = await withTenant(context.services.handle, context.actor, (tx) =>
    validateAuthorizationRequest(tx, params),
  );

  if (validated.kind === 'redirect') {
    redirect(
      callbackUrl(validated.redirectUri, {
        error: validated.error,
        error_description: validated.description,
        state: validated.state,
      }),
    );
  }

  if (validated.kind === 'show') {
    return (
      <AppShell current="/connections" email={context.email} narrow>
        <h1 className="cairn-page-title">{validated.title}</h1>
        <Callout tone="warn" title="Nothing has been shared">
          {validated.detail}
        </Callout>
        <div style={{ marginTop: '1.5rem' }}>
          <Link href="/connections" className="cairn-button cairn-button--primary">
            Go to Connected AIs
          </Link>
        </div>
      </AppShell>
    );
  }

  const { request } = validated;
  const canPropose = request.scopes.includes('memory:propose');

  return (
    <AppShell current="/connections" email={context.email} narrow>
      <h1 className="cairn-page-title">Let {request.client.clientName} use your memory?</h1>
      <p className="cairn-page-lede">
        It is asking to look things up in <strong>{name}</strong>. Nothing is shared until you say
        yes, and you can turn this off at any time.
      </p>

      <Card>
        <h2 className="cairn-card__title">What it will be able to do</h2>
        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.125rem' }}>
          <li>Look up memory you have already kept, and see where each piece came from.</li>
          {canPropose ? (
            <li>Suggest new things to remember. You still review every one before it is saved.</li>
          ) : null}
        </ul>

        <h2 className="cairn-card__title" style={{ marginTop: '1.25rem' }}>
          What it will never be able to do
        </h2>
        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.125rem' }}>
          <li>See anything still waiting for your review, or anything you removed.</li>
          <li>Change or delete what you have saved.</li>
        </ul>

        {/* Sensitive memory is opt-in per connection rather than inherited from
            a previous one. Someone connecting a work tool and a personal one
            should not have the second quietly reuse the first one's answer. */}
        <ActionForm
          action={approveAiConnection}
          csrf={csrf}
          hidden={{ request: params.toString() }}
          className="cairn-stack cairn-stack--md"
        >
          <fieldset className="cairn-fieldset" style={{ marginTop: '1.25rem' }}>
            <legend>Anything else?</legend>
            <label className="cairn-choice">
              <input type="checkbox" name="includeSensitive" />
              Include memory you marked sensitive
            </label>
          </fieldset>
          <div className="cairn-row">
            <SubmitButton tone="primary" busyLabel="Connecting…">
              Yes, connect it
            </SubmitButton>
          </div>
        </ActionForm>

        <div style={{ marginTop: '0.75rem' }}>
          <ActionForm action={denyAiConnection} csrf={csrf} hidden={{ request: params.toString() }}>
            <SubmitButton tone="quiet" busyLabel="Cancelling…">
              No, cancel
            </SubmitButton>
          </ActionForm>
        </div>
      </Card>

      <Callout tone="info" title="One thing worth knowing">
        Once a tool has your text, that company&rsquo;s own terms apply to it. That is true of every
        AI tool, and it is why nothing is shared until you decide.
      </Callout>
    </AppShell>
  );
}
