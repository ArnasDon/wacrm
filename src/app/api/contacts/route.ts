import {
  accountRoute,
  readObject,
  RequestError,
  requireUUID,
} from '@/lib/api/local-route';
import {
  createContact,
  deleteContacts,
  listContacts,
  type ContactInput,
} from '@/lib/db/contacts';

export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return accountRoute(request, 'viewer', async (db, ctx) => {
    const params = new URL(request.url).searchParams;
    const limit = Number(params.get('limit') ?? 25);
    const offset = Number(params.get('offset') ?? 0);
    const tags = params.getAll('tag').map(requireUUID);
    if (
      !Number.isInteger(limit) ||
      !Number.isInteger(offset) ||
      limit < 1 ||
      limit > 200 ||
      offset < 0 ||
      tags.length > 100
    )
      throw new RequestError('Invalid pagination or tag filters.');
    return listContacts(db, ctx.accountId, {
      search: params.get('search') ?? '',
      limit,
      offset,
      tagIds: tags,
    });
  });
}
export function POST(request: Request) {
  return accountRoute(request, 'agent', async (db, ctx) => {
    const body = await readObject(request);
    const input: ContactInput = { phone: '' };
    for (const key of ['phone', 'name', 'email', 'company'] as const) {
      if (
        body[key] !== undefined &&
        body[key] !== null &&
        (typeof body[key] !== 'string' || (body[key] as string).length > 1000)
      )
        throw new RequestError(`Invalid ${key}.`);
      if (key === 'phone')
        input.phone = typeof body.phone === 'string' ? body.phone : '';
      else input[key] = body[key] as string | null | undefined;
    }
    if (!input.phone.replace(/\D/g, ''))
      throw new RequestError('A phone number is required.');
    return { contact: await createContact(db, ctx.userId, input) };
  });
}
export function DELETE(request: Request) {
  return accountRoute(request, 'agent', async (db, ctx) => {
    const body = await readObject(request);
    if (!Array.isArray(body.ids) || body.ids.length > 200)
      throw new RequestError('Provide up to 200 contact IDs.');
    return {
      deleted: await deleteContacts(
        db,
        ctx.accountId,
        body.ids.map(requireUUID)
      ),
    };
  });
}
