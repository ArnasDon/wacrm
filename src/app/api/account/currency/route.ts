import { accountRoute, readObject, RequestError } from '@/lib/api/local-route';
import { CURRENCIES } from '@/lib/currency';
import { queryRows } from '@/lib/db/rows';
export function PATCH(request: Request) {
  return accountRoute(request, 'admin', async (db, ctx) => {
    const { default_currency } = await readObject(request);
    if (
      typeof default_currency !== 'string' ||
      !CURRENCIES.some((currency) => currency.code === default_currency)
    )
      throw new RequestError('Unsupported currency.');
    const [account] = await queryRows(
      db,
      'UPDATE public.accounts SET default_currency=$1 WHERE id=$2 RETURNING id,name,default_currency',
      [default_currency, ctx.accountId]
    );
    return { account };
  });
}
