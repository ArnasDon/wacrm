import { accountRoute, readObject, requireUUID } from '@/lib/api/local-route';
import {
  listNotifications,
  markNotificationsRead,
} from '@/lib/db/member-status';
export function GET(request: Request) {
  return accountRoute(request, 'viewer', async (db, ctx) => ({
    notifications: await listNotifications(db, ctx.accountId, ctx.userId),
  }));
}
export function PATCH(request: Request) {
  return accountRoute(request, 'viewer', async (db, ctx) => {
    const body = await readObject(request);
    return {
      updated: await markNotificationsRead(
        db,
        ctx.accountId,
        ctx.userId,
        body.all === true ? null : requireUUID(body.id)
      ),
    };
  });
}
