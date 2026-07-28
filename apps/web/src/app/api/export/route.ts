import { auditRepo, withTenant } from '@cairn/db';
import { exportProjectMarkdown } from '@cairn/vault';
import { requireContext, resolveProject } from '@/server/context';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Readable export.
 *
 * A GET so the browser downloads it directly. It contains only approved memory
 * rendered as Markdown — no keys, no raw documents, nothing that needs this
 * product to read.
 */
export async function GET(request: Request): Promise<Response> {
  const context = await requireContext();
  const url = new URL(request.url);
  const project = await resolveProject(context, url.searchParams.get('projectId'));

  const result = await exportProjectMarkdown(
    context.services.handle,
    context.services.keyring,
    context.services.vault,
    context.actor,
    project.id,
  );

  await withTenant(context.services.handle, context.actor, (tx) =>
    auditRepo.recordAudit(tx, {
      workspaceId: context.actor.workspaceId,
      actorUserId: context.actor.userId,
      action: 'export.created',
      subjectType: 'project',
      subjectId: project.id,
      metadata: { itemCount: result.itemCount, bytes: result.bytes.byteLength },
    }),
  );

  return new Response(result.bytes as unknown as BodyInit, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${result.filename}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
