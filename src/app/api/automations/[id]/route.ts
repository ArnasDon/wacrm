import {
  accountRoute,
  readObject,
  requireUUID,
  RequestError,
} from '@/lib/api/local-route';
import {
  readAutomation,
  updateAutomation,
  deleteAutomation,
  parseAutomationInput,
} from '@/lib/db/automations';
type Context = { params: Promise<{ id: string }> };
export function GET(request: Request, { params }: Context) {
  return accountRoute(request, 'viewer', async (db, ctx) => {
    const result = await readAutomation(
      db,
      ctx.accountId,
      requireUUID((await params).id)
    );
    if (!result) throw new RequestError('Automation not found.', 404);
    return result;
  });
}
export function PATCH(request: Request, { params }: Context) {
  return accountRoute(request, 'agent', async (db, ctx) => {
    if (
      !(await updateAutomation(
        db,
        ctx.accountId,
        requireUUID((await params).id),
        parseAutomationInput(await readObject(request))
      ))
    )
      throw new RequestError('Automation not found.', 404);
    return { ok: true };
  });
}
export function DELETE(request: Request, { params }: Context) {
  return accountRoute(request, 'agent', async (db, ctx) => {
    if (
      !(await deleteAutomation(
        db,
        ctx.accountId,
        requireUUID((await params).id)
      ))
    )
      throw new RequestError('Automation not found.', 404);
    return { ok: true };
  });
}
