import { accountRoute, readObject } from '@/lib/api/local-route';
import { createQuickReply, listQuickReplies } from '@/lib/db/quick-replies';
export function GET(request: Request) {
  return accountRoute(request, 'viewer', async (db, ctx) => ({
    quick_replies: await listQuickReplies(db, ctx.accountId),
  }));
}
export async function POST(request: Request) {
  const response = await accountRoute(request, 'agent', async (db, ctx) => ({
    quick_reply: await createQuickReply(db, ctx, await readObject(request)),
  }));
  return response.ok
    ? new Response(response.body, { status: 201, headers: response.headers })
    : response;
}
