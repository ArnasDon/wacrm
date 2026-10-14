import {
  requireLocalApiKey,
  withApiKeyAccount,
  apiUUID,
} from '@/lib/auth/api-context-local';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { getConversation } from '@/lib/db/inbox';
import { serializeConversation } from '@/lib/api/v1/conversations';
export async function GET(
  request: Request,
  route: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireLocalApiKey(request, 'conversations:read');
    const id = apiUUID((await route.params).id);
    const conversation = await withApiKeyAccount(
      ctx,
      'conversations:read',
      (db) => getConversation(db, ctx.accountId, id)
    );
    return conversation
      ? ok(serializeConversation(conversation))
      : fail('not_found', 'Conversation not found', 404);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
