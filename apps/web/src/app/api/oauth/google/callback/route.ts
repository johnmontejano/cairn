import { and, eq } from 'drizzle-orm';
import { exchangeGoogleCode, googleDriveConfig } from '@cairn/connectors';
import { auditRepo, jobsRepo, schema, withTenant } from '@cairn/db';
import { DomainError } from '@cairn/domain';
import { requireContext } from '@/server/context';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Google Drive OAuth callback.
 *
 * The `state` parameter carries the connection this grant belongs to and is
 * checked against a connection in the signed-in user's own workspace, so a
 * callback cannot attach someone else's Google account to your memory.
 */
export async function GET(request: Request): Promise<Response> {
  const context = await requireContext();
  const config = googleDriveConfig(context.services.config);
  const url = new URL(request.url);
  const redirectTo = (message: string, ok = false) =>
    Response.redirect(
      `${context.services.config.appUrl}/sources?${ok ? 'connected' : 'error'}=${encodeURIComponent(message)}`,
      303,
    );

  if (!config) return redirectTo('Google Drive is not set up on this server.');
  if (url.searchParams.get('error')) return redirectTo('You cancelled the Google connection.');

  const code = url.searchParams.get('code');
  const connectionId = url.searchParams.get('state');
  if (!code || !connectionId) return redirectTo('That connection link was incomplete.');

  try {
    const tokens = await exchangeGoogleCode(config, code);
    const crypto = await context.services.keyring.get(context.actor.workspaceId);

    await withTenant(context.services.handle, context.actor, async (tx) => {
      const [connection] = await tx
        .select()
        .from(schema.sourceConnections)
        .where(
          and(
            eq(schema.sourceConnections.workspaceId, context.actor.workspaceId),
            eq(schema.sourceConnections.id, connectionId),
            eq(schema.sourceConnections.provider, 'google_drive'),
          ),
        )
        .limit(1);
      if (!connection)
        throw new DomainError(
          'Unknown connection',
          'not_found',
          404,
          'That connection no longer exists.',
        );

      await tx
        .update(schema.sourceConnections)
        .set({
          state: 'active',
          // The refresh token is encrypted with the workspace's credential key,
          // bound to this connection row.
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
        metadata: { provider: 'google_drive', scopes: 'drive.readonly' },
      });
    });

    return redirectTo('Google Drive connected. We are reading it now.', true);
  } catch (error) {
    context.services.logger.error('oauth.google_failed', { error });
    return redirectTo(
      error instanceof DomainError
        ? error.userMessage
        : 'That Google connection could not be completed.',
    );
  }
}
