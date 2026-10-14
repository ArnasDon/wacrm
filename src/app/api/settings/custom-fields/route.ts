import {
  accountRoute,
  readObject,
  RequestError,
  requireUUID,
} from '@/lib/api/local-route';
import {
  createCustomField,
  listCustomFields,
  renameCustomField,
  deleteCustomField,
} from '@/lib/db/contact-details';

export function GET(request: Request) {
  return accountRoute(request, 'viewer', async (db, ctx) => ({
    fields: await listCustomFields(db, ctx.accountId),
  }));
}
function name(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100)
    throw new RequestError('Field name must contain 1–100 characters.');
  return value.trim();
}
export function POST(request: Request) {
  return accountRoute(request, 'admin', async (db, ctx) => ({
    field: await createCustomField(
      db,
      ctx.userId,
      name((await readObject(request)).field_name)
    ),
  }));
}
export function PATCH(request: Request) {
  return accountRoute(request, 'admin', async (db, ctx) => {
    const body = await readObject(request);
    if (
      !(await renameCustomField(
        db,
        ctx.accountId,
        requireUUID(body.id),
        name(body.field_name)
      ))
    )
      throw new RequestError('Field not found.', 404);
    return { ok: true };
  });
}
export function DELETE(request: Request) {
  return accountRoute(request, 'admin', async (db, ctx) => {
    if (
      !(await deleteCustomField(
        db,
        ctx.accountId,
        requireUUID((await readObject(request)).id)
      ))
    )
      throw new RequestError('Field not found.', 404);
    return { ok: true };
  });
}
