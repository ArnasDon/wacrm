import { accountRoute } from '@/lib/api/local-route';
import { unreadCounts } from '@/lib/db/member-status';
export function GET(request: Request) {
  return accountRoute(request, 'viewer', (db, ctx) =>
    unreadCounts(db, ctx.accountId, ctx.userId)
  );
}
