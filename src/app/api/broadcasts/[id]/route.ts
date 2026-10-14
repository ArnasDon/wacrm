import { accountRoute, requireUUID, RequestError } from '@/lib/api/local-route';
import { BroadcastStore } from '@/lib/db/broadcasts';
type Params = { params: Promise<{ id: string }> };
export function GET(request: Request, { params }: Params) {
  return accountRoute(request, 'viewer', async (db, ctx) => {
    const id = requireUUID((await params).id);
    const store = new BroadcastStore(db, ctx.accountId);
    const broadcast = await store.get(id);
    if (!broadcast) throw new RequestError('Broadcast not found.', 404);
    return { broadcast, recipients: await store.recipients(id) };
  });
}
export function DELETE(request: Request, { params }: Params) {
  return accountRoute(request, 'agent', async (db, ctx) => {
    await new BroadcastStore(db, ctx.accountId).delete(
      requireUUID((await params).id)
    );
    return { ok: true };
  });
}
