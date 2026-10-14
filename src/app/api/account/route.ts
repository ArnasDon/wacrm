import { accountRoute, readObject, RequestError } from '@/lib/api/local-route';
import { queryRows } from '@/lib/db/rows';

export function GET(request: Request) {
  return accountRoute(request, 'viewer', async (_db, ctx) => ({
    account: ctx.account,
    role: ctx.role,
  }));
}
export function PATCH(request: Request) {
  return accountRoute(request, 'admin', async (db, ctx) => {
    const body = await readObject(request);
    if (
      typeof body.name !== 'string' ||
      !body.name.trim() ||
      body.name.trim().length > 80
    )
      throw new RequestError('Account name must contain 1–80 characters.');
    const [account] = await queryRows(
      db,
      'UPDATE public.accounts SET name=$1 WHERE id=$2 RETURNING id,name',
      [body.name.trim(), ctx.accountId]
    );
    return { account };
  });
}
