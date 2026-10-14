import {
  accountRoute,
  readObject,
  requireUUID,
  RequestError,
} from '@/lib/api/local-route';
import {
  readFlow,
  updateFlow,
  deleteFlow,
  parseFlowInput,
} from '@/lib/db/flows';
type Context = { params: Promise<{ id: string }> };
export function GET(request: Request, { params }: Context) {
  return accountRoute(request, 'viewer', async (db, ctx) => {
    const result = await readFlow(
      db,
      ctx.accountId,
      requireUUID((await params).id)
    );
    if (!result) throw new RequestError('Flow not found.', 404);
    return result;
  });
}
export function PUT(request: Request, { params }: Context) {
  return accountRoute(request, 'agent', async (db, ctx) => {
    const result = await updateFlow(
      db,
      ctx.accountId,
      requireUUID((await params).id),
      parseFlowInput(await readObject(request))
    );
    if (!result) throw new RequestError('Flow not found.', 404);
    return result;
  });
}
export function DELETE(request: Request, { params }: Context) {
  return accountRoute(request, 'agent', async (db, ctx) => {
    if (!(await deleteFlow(db, ctx.accountId, requireUUID((await params).id))))
      throw new RequestError('Flow not found.', 404);
    return { ok: true };
  });
}
