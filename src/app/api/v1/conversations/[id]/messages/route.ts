import {
  requireLocalApiKey,
  withApiKeyAccount,
  apiUUID,
} from '@/lib/auth/api-context-local';
import { okList, toApiErrorResponse } from '@/lib/api/v1/respond';
import { parseListParams, buildPage } from '@/lib/api/v1/pagination';
import { listApiMessages } from '@/lib/db/public-api';
import { serializeMessage } from '@/lib/api/v1/conversations';
export async function GET(
  request: Request,
  route: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireLocalApiKey(request, 'messages:read');
    const id = apiUUID((await route.params).id);
    const options = parseListParams(request);
    const rows = await withApiKeyAccount(ctx, 'messages:read', (db) =>
      listApiMessages(db, ctx.accountId, id, options)
    );
    const page = buildPage(rows, options.limit);
    return okList(page.items.map(serializeMessage), page.nextCursor);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
