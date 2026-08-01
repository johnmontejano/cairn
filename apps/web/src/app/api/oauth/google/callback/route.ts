import { eq } from 'drizzle-orm';
import {
  CALENDAR_SCOPES,
  DRIVE_SCOPES,
  GMAIL_SCOPES,
  exchangeGoogleCode,
  googleOAuthConfig,
} from '@cairn/connectors';
import { auditRepo, jobsRepo, schema, withTenant } from '@cairn/db';
import { DomainError } from '@cairn/domain';
import { requireContext } from '@/server/context';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Google OAuth callback, shared by every Google-family connector.
 *
 * Drive, Gmail and Calendar sit behind one Google Cloud client — see
 * @cairn/connectors's google.ts — so they share this one callback rather than
 * each having their own. What distinguishes them is only which scopes to
 * validate the grant against, looked up from the connection's own `provider`
 * column rather than assumed, because the `state` parameter alone does not say
 * which product was being authorized.
 *
 * Generalized from a Drive-only version on 2026-08-01. Until this file
 * existed only Drive was reachable this way, and even Drive was unreachable in
 * practice: nothing in the app ever called the function that builds this
 * flow's authorize URL, so clicking "Connect" created a row and went nowhere.
 * See connectSource in actions.ts for the other half of that fix.
 *
 * The `state` parameter carries the connection this grant belongs to and is
 * checked against a connection in the signed-in user's own workspace, so a
 * callback cannot attach someone else's Google account to your memory.
 */

const SCOPES_BY_PROVIDER: Partial<Record<string, readonly string[]>> = {
  google_drive: DRIVE_SCOPES,
  gmail: GMAIL_SCOPES,
  google_calendar: CALENDAR_SCOPES,
};

export async function GET(request: Request): Promise<Response> {
  const context = await requireContext();
  const config = googleOAuthConfig(context.services.config);
  const url = new URL(request.url);
  const redirectTo = (message: string, ok = false) =>
    Response.redirect(
      `${context.services.config.appUrl}/sources?${ok ? 'connected' : 'error'}=${encodeURIComponent(message)}`,
      303,
    );

  if (!config) return redirectTo('Google sign-in is not set up on this server.');
  if (url.searchParams.get('error')) return redirectTo('You cancelled the Google connection.');

  const code = url.searchParams.get('code');
  const connectionId = url.searchParams.get('state');
  if (!code || !connectionId) return redirectTo('That connection link was incomplete.');

  try {
    const providerConnected = await withTenant(
      context.services.handle,
      context.actor,
      async (tx) => {
        const [connection] = await tx
          .select()
          .from(schema.sourceConnections)
          .where(eq(schema.sourceConnections.id, connectionId))
          .limit(1);
        if (!connection || connection.workspaceId !== context.actor.workspaceId) {
          throw new DomainError(
            'Unknown connection',
            'not_found',
            404,
            'That connection no longer exists.',
          );
        }

        const scopes = SCOPES_BY_PROVIDER[connection.provider];
        if (!scopes) {
          throw new DomainError(
            'Not a Google connection',
            'validation_failed',
            400,
            'That connection is not one this page can finish.',
          );
        }

        // Exchanged before anything is written, so a rejected or malformed grant
        // never touches the row.
        const tokens = await exchangeGoogleCode(config, code, scopes);
        const crypto = await context.services.keyring.get(context.actor.workspaceId);

        await tx
          .update(schema.sourceConnections)
          .set({
            state: 'active',
            // Bound to this connection row by its own id, so the ciphertext
            // cannot be replayed against a different connection.
            encryptedCredential: crypto.encryptCredential(JSON.stringify(tokens), connectionId),
            lastError: null,
          })
          .where(eq(schema.sourceConnections.id, connectionId));

        await jobsRepo.enqueueIn(tx, {
          workspaceId: context.actor.workspaceId,
          projectId: connection.projectId,
          type: 'connection.sync',
          idempotencyKey: `sync:${connectionId}:first`,
          payload: { connectionId },
        });
        await auditRepo.recordAudit(tx, {
          workspaceId: context.actor.workspaceId,
          actorUserId: context.actor.userId,
          action: 'source.connected',
          subjectType: 'source_connection',
          subjectId: connectionId,
          metadata: { provider: connection.provider, scopes },
        });

        return connection.provider;
      },
    );

    return redirectTo(`Connected. We are reading ${providerConnected} now.`, true);
  } catch (error) {
    context.services.logger.error('oauth.google_failed', { error });
    return redirectTo(
      error instanceof DomainError
        ? error.userMessage
        : 'That Google connection could not be completed.',
    );
  }
}
