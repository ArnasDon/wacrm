import { accountRoute, requireUUID } from '@/lib/api/local-route';
import { listConversations, pollMessages } from '@/lib/db/inbox';
export function GET(request: Request) {
  return accountRoute(request, 'viewer', async (db, ctx) => {
    const raw = new URL(request.url).searchParams.get('conversationId');
    return {
      conversations: await listConversations(db, ctx.accountId),
      messages: await pollMessages(
        db,
        ctx.accountId,
        raw ? requireUUID(raw) : null
      ),
    };
  });
}
