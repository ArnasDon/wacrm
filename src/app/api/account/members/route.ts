import { accountRoute } from '@/lib/api/local-route';
import { listMembers } from '@/lib/db/accounts';

export function GET(request: Request) {
  return accountRoute(request, 'viewer', async (db, ctx) => ({
    members: await listMembers(db, ctx.userId),
  }));
}
