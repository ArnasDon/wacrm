import {
  requireLocalApiKey,
  withApiKeyAccount,
  apiUUID,
} from '@/lib/auth/api-context-local';
import { okList, toApiErrorResponse, badRequest } from '@/lib/api/v1/respond';
import { parseListParams, buildPage } from '@/lib/api/v1/pagination';
import { listApiConversations } from '@/lib/db/public-api';
import { serializeConversation } from '@/lib/api/v1/conversations';
export async function GET(request: Request) {
  try {
    const ctx = await requireLocalApiKey(request, 'conversations:read');
    const options = parseListParams(request);
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const contactId = url.searchParams.get('contact_id');
    if (status && !['open', 'pending', 'closed'].includes(status))
      throw badRequest('Invalid status.');
    if (contactId) apiUUID(contactId, 'contact_id');
    const rows = await withApiKeyAccount(ctx, 'conversations:read', (db) =>
      listApiConversations(db, ctx.accountId, { ...options, status, contactId })
    );
    const page = buildPage(rows, options.limit);
    return okList(page.items.map(serializeConversation), page.nextCursor);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
