import { accountRoute, readObject, requireUUID } from '@/lib/api/local-route';
import { deleteQuickReply, updateQuickReply } from '@/lib/db/quick-replies';
type Context = { params: Promise<{ id: string }> };
export function PATCH(request: Request, { params }: Context) {
  return accountRoute(request, 'agent', async (db, ctx) => {
    await updateQuickReply(
      db,
      ctx.accountId,
      requireUUID((await params).id),
      await readObject(request)
    );
    return { ok: true };
  });
}
export function DELETE(request: Request, { params }: Context) {
  return accountRoute(request, 'agent', async (db, ctx) => {
    await deleteQuickReply(db, ctx.accountId, requireUUID((await params).id));
    return { ok: true };
  });
}
