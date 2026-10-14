import { accountRoute } from '@/lib/api/local-route';
import { listConversations } from '@/lib/db/inbox';
export function GET(request: Request) {
  return accountRoute(request, 'viewer', async (db, ctx) => ({
    conversations: await listConversations(db, ctx.accountId),
  }));
}
