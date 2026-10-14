import { accountRoute, requireUUID, RequestError } from '@/lib/api/local-route';
import { automationLogs } from '@/lib/db/automations';
export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return accountRoute(request, 'viewer', async (db, ctx) => {
    const result = await automationLogs(
      db,
      ctx.accountId,
      requireUUID((await params).id)
    );
    if (!result) throw new RequestError('Automation not found.', 404);
    return result;
  });
}
