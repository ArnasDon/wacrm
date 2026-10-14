import {
  accountRoute,
  readObject,
  RequestError,
  requireUUID,
} from '@/lib/api/local-route';
import { dealInput } from '@/lib/api/deal-input';
import { saveDeal, deleteDeal } from '@/lib/db/deals';
type Context = { params: Promise<{ id: string }> };
export function PATCH(request: Request, context: Context) {
  return accountRoute(request, 'agent', async (db, ctx) => ({
    deal: await saveDeal(
      db,
      ctx.userId,
      requireUUID((await context.params).id),
      dealInput(await readObject(request))
    ),
  }));
}
export function DELETE(request: Request, context: Context) {
  return accountRoute(request, 'agent', async (db, ctx) => {
    if (
      !(await deleteDeal(
        db,
        ctx.accountId,
        requireUUID((await context.params).id)
      ))
    )
      throw new RequestError('Deal not found.', 404);
    return { ok: true };
  });
}
