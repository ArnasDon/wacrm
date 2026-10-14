import { accountRoute, RequestError, requireUUID } from '@/lib/api/local-route';
import { revokeInvitation } from '@/lib/db/invitations';

export function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return accountRoute(request, 'admin', async (db, ctx) => {
    if (
      !(await revokeInvitation(
        db,
        ctx.accountId,
        requireUUID((await params).id)
      ))
    )
      throw new RequestError('Invitation not found.', 404);
    return { ok: true };
  });
}
