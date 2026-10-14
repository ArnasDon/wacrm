import { accountRoute, requireUUID, RequestError } from '@/lib/api/local-route';
import { flowRuns } from '@/lib/db/flows';
export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return accountRoute(request, 'viewer', async (db, ctx) => {
    const result = await flowRuns(
      db,
      ctx.accountId,
      requireUUID((await params).id)
    );
    if (!result) throw new RequestError('Flow not found.', 404);
    return result;
  });
}
