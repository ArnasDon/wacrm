import { accountRoute, requireUUID, RequestError } from '@/lib/api/local-route';
import { revokeKey } from '@/lib/db/api-keys';

export function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return accountRoute(request, 'admin', async (db, ctx) => {
    if (!(await revokeKey(db, ctx.accountId, requireUUID((await params).id))))
      throw new RequestError('API key not found or already revoked.', 404);
    return { success: true };
  });
}
