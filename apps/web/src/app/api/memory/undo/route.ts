import { and, eq } from 'drizzle-orm';
import { auditRepo, schema, withTenant } from '@cairn/db';
import { DomainError } from '@cairn/domain';
import { assertCsrf, requireContext } from '@/server/context';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Undo a removal.
 *
 * A plain form post to a route handler rather than a server action. Undo appears
 * on pages that already carry a sign-out form, and the framework's action
 * dispatch proved unreliable there — a form quietly invoking a different action
 * is not a failure mode worth risking on a destructive-looking control. An
 * ordinary POST and a redirect have no such ambiguity, and work with or without
 * JavaScript.
 */
export async function POST(request: Request): Promise<Response> {
  const context = await requireContext();
  const formData = await request.formData();
  const back = new URL(
    String(formData.get('returnTo') ?? '/history'),
    context.services.config.appUrl,
  );
  // Only ever return to a path within this app.
  const target = new URL(back.pathname + back.search, context.services.config.appUrl);

  try {
    await assertCsrf(formData);
    const memoryItemId = String(formData.get('memoryItemId') ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(memoryItemId)) {
      throw new DomainError('bad id', 'validation_failed', 400, 'That memory could not be found.');
    }

    await withTenant(context.services.handle, context.actor, async (tx) => {
      const restored = await tx
        .update(schema.memoryItems)
        .set({ deletedAt: null, status: 'proposed' })
        .where(
          and(
            eq(schema.memoryItems.workspaceId, context.actor.workspaceId),
            eq(schema.memoryItems.id, memoryItemId),
          ),
        )
        .returning({ id: schema.memoryItems.id });
      if (restored.length > 0) {
        await auditRepo.recordAudit(tx, {
          workspaceId: context.actor.workspaceId,
          actorUserId: context.actor.userId,
          action: 'memory.edited',
          subjectType: 'memory_item',
          subjectId: memoryItemId,
          metadata: { change: 'restored' },
        });
      }
    });
    target.searchParams.set('restored', '1');
  } catch (error) {
    const message =
      error instanceof DomainError ? error.userMessage : 'That could not be put back.';
    if (!(error instanceof DomainError)) {
      context.services.logger.error('undo.failed', { error });
      context.services.errors.captureException(error, { area: 'undo' });
    }
    target.searchParams.set('undoError', message);
  }

  return Response.redirect(target.toString(), 303);
}
