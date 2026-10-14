import { accountRoute, readObject, requireUUID } from '@/lib/api/local-route';
import { dealInput } from '@/lib/api/deal-input';
import { listDeals, saveDeal } from '@/lib/db/deals';
export function GET(request: Request) {
  return accountRoute(request, 'viewer', async (db, ctx) => ({
    deals: await listDeals(
      db,
      ctx.accountId,
      requireUUID(new URL(request.url).searchParams.get('pipelineId'))
    ),
  }));
}
export function POST(request: Request) {
  return accountRoute(request, 'agent', async (db, ctx) => ({
    deal: await saveDeal(
      db,
      ctx.userId,
      null,
      dealInput(await readObject(request))
    ),
  }));
}
