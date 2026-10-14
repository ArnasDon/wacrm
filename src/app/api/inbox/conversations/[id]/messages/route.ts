import { accountRoute, requireUUID } from '@/lib/api/local-route';
import { listMessages, listReactions } from '@/lib/db/inbox';
type Context = { params: Promise<{ id: string }> };
export function GET(request: Request, context: Context) {
  return accountRoute(request, 'viewer', async (db, ctx) => {
    const id = requireUUID((await context.params).id);
    return {
      messages: await listMessages(db, ctx.accountId, id),
      reactions: await listReactions(db, ctx.accountId, id),
    };
  });
}
