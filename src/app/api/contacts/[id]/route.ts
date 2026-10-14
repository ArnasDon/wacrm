import {
  accountRoute,
  readObject,
  RequestError,
  requireUUID,
} from '@/lib/api/local-route';
import {
  getContact,
  updateContact,
  type ContactInput,
} from '@/lib/db/contacts';

type Context = { params: Promise<{ id: string }> };
export function GET(request: Request, { params }: Context) {
  return accountRoute(request, 'viewer', async (db, ctx) => {
    const contact = await getContact(
      db,
      ctx.accountId,
      requireUUID((await params).id)
    );
    if (!contact) throw new RequestError('Contact not found.', 404);
    return { contact };
  });
}
export function PATCH(request: Request, { params }: Context) {
  return accountRoute(request, 'agent', async (db, ctx) => {
    const body = await readObject(request);
    const input: Partial<ContactInput> = {};
    for (const key of ['phone', 'name', 'email', 'company'] as const) {
      if (!Object.hasOwn(body, key)) continue;
      if (
        body[key] !== null &&
        (typeof body[key] !== 'string' || (body[key] as string).length > 1000)
      )
        throw new RequestError(`Invalid ${key}.`);
      if (key === 'phone') {
        if (typeof body.phone !== 'string' || !body.phone.replace(/\D/g, ''))
          throw new RequestError('A phone number is required.');
        input.phone = body.phone;
      } else input[key] = body[key] as string | null;
    }
    const contact = await updateContact(
      db,
      ctx.accountId,
      requireUUID((await params).id),
      input
    );
    if (!contact) throw new RequestError('Contact not found.', 404);
    return { contact };
  });
}
