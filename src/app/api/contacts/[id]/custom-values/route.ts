import {
  accountRoute,
  readObject,
  RequestError,
  requireUUID,
} from '@/lib/api/local-route';
import { getCustomValues, setCustomValues } from '@/lib/db/contact-details';

type Context = { params: Promise<{ id: string }> };
export function GET(request: Request, { params }: Context) {
  return accountRoute(request, 'viewer', async (db, ctx) => ({
    values: await getCustomValues(
      db,
      ctx.accountId,
      requireUUID((await params).id)
    ),
  }));
}
export function PUT(request: Request, { params }: Context) {
  return accountRoute(request, 'agent', async (db, ctx) => {
    const raw = (await readObject(request)).values;
    if (
      !raw ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      Object.keys(raw).length > 100
    )
      throw new RequestError('Provide at most 100 custom field values.');
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      requireUUID(key);
      if (typeof value !== 'string' || value.length > 20000)
        throw new RequestError(
          'Custom values must be strings of at most 20,000 characters.'
        );
      values[key] = value;
    }
    await setCustomValues(
      db,
      ctx.accountId,
      requireUUID((await params).id),
      values
    );
    return { ok: true };
  });
}
