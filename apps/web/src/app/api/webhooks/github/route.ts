import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { githubAppConfig, verifyGitHubSignature } from '@cairn/connectors';
import { jobsRepo, schema, withSystem } from '@cairn/db';
import { getServices } from '@cairn/ingestion';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GitHub webhook receiver.
 *
 * Follows GitHub's own guidance to the letter: verify the signature before
 * touching the payload, recognise redeliveries by `X-GitHub-Delivery`, do the
 * actual work asynchronously, and answer quickly. Anything slower than that gets
 * the delivery retried, which is how duplicate ingestion starts.
 */
export async function POST(request: Request): Promise<Response> {
  const services = await getServices();
  const config = githubAppConfig(services.config);
  if (!config) {
    return Response.json({ error: 'GitHub is not configured' }, { status: 503 });
  }

  const raw = await request.text();
  if (
    !verifyGitHubSignature(config.webhookSecret, raw, request.headers.get('x-hub-signature-256'))
  ) {
    services.logger.warn('webhook.signature_rejected', { provider: 'github' });
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const deliveryId = request.headers.get('x-github-delivery');
  const event = request.headers.get('x-github-event') ?? 'unknown';
  if (!deliveryId) return Response.json({ error: 'Missing delivery id' }, { status: 400 });

  const payload = JSON.parse(raw) as {
    installation?: { id?: number };
    repository?: { full_name?: string };
  };
  const installationId = payload.installation?.id ? String(payload.installation.id) : null;

  const outcome = await withSystem(services.handle, async (tx) => {
    const inserted = await tx
      .insert(schema.webhookDeliveries)
      .values({ provider: 'github', deliveryId })
      .onConflictDoNothing()
      .returning({ id: schema.webhookDeliveries.deliveryId });
    if (inserted.length === 0) return { status: 'duplicate' as const };

    if (!installationId || !['push', 'installation_repositories'].includes(event)) {
      return { status: 'ignored' as const };
    }

    // Match the installation to connections that opted into it. A webhook alone
    // never establishes which workspace it belongs to.
    const connections = await tx
      .select()
      .from(schema.sourceConnections)
      .where(eq(schema.sourceConnections.provider, 'github'));
    const matching = connections.filter((c) => c.externalAccountLabel === installationId);

    for (const connection of matching) {
      await jobsRepo.enqueueIn(tx, {
        workspaceId: connection.workspaceId,
        projectId: connection.projectId,
        type: 'connection.sync',
        idempotencyKey: `github-delivery:${deliveryId}:${connection.id}`,
        payload: { connectionId: connection.id, deliveryId, event },
      });
    }
    return { status: 'queued' as const, connections: matching.length };
  });

  services.logger.info('webhook.received', { provider: 'github', event, ...outcome });
  // 202 regardless of what was queued: the sender should not learn which
  // workspaces exist from the response.
  return Response.json({ received: true, id: randomUUID() }, { status: 202 });
}
