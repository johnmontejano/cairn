import { auditRepo, withTenant } from '@cairn/db';
import { DomainError } from '@cairn/domain';
import { createProjectBackup } from '@cairn/vault';
import { assertCsrf, requireContext, resolveProject } from '@/server/context';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Encrypted backup download.
 *
 * A POST because it carries a passphrase, which must never end up in a URL, a
 * browser history entry, or a server access log.
 */
export async function POST(request: Request): Promise<Response> {
  const context = await requireContext();
  const formData = await request.formData();

  try {
    await assertCsrf(formData);
    const project = await resolveProject(context, String(formData.get('projectId') ?? ''));
    const passphrase = String(formData.get('passphrase') ?? '');

    const backup = await createProjectBackup(
      context.services.handle,
      context.services.keyring,
      context.services.vault,
      context.actor,
      { projectId: project.id, passphrase, kind: 'manual' },
    );

    await withTenant(context.services.handle, context.actor, (tx) =>
      auditRepo.recordAudit(tx, {
        workspaceId: context.actor.workspaceId,
        actorUserId: context.actor.userId,
        action: 'backup.created',
        subjectType: 'backup',
        subjectId: backup.backupId,
        metadata: { bytes: backup.bytes.byteLength, contentHash: backup.contentHash },
      }),
    );

    return new Response(backup.bytes as unknown as BodyInit, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${backup.filename}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    const message =
      error instanceof DomainError ? error.userMessage : 'The backup could not be created.';
    if (!(error instanceof DomainError)) {
      context.services.logger.error('backup.failed', { error });
      context.services.errors.captureException(error, { area: 'backup' });
    }
    // Redirect rather than render, so the passphrase is not re-posted on refresh.
    return Response.redirect(
      `${context.services.config.appUrl}/settings?backupError=${encodeURIComponent(message)}`,
      303,
    );
  }
}
