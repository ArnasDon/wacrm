import {
  requireLocalApiKey,
  withApiKeyAccount,
  apiUUID,
} from '@/lib/auth/api-context-local';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { BroadcastStore } from '@/lib/db/broadcasts';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireLocalApiKey(request, 'broadcasts:send');
    const id = apiUUID((await params).id);
    const row = await withApiKeyAccount(ctx, 'broadcasts:send', (db) =>
      new BroadcastStore(db, ctx.accountId).get(id)
    );
    if (!row) return fail('not_found', 'Broadcast not found.', 404);
    return ok(row);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
