import { accountRoute, RequestError } from '@/lib/api/local-route';
import { findContactByPhone } from '@/lib/db/contacts';

export function GET(request: Request) {
  return accountRoute(request, 'viewer', async (db, ctx) => {
    const phone = new URL(request.url).searchParams.get('phone') ?? '';
    if (phone.length > 100) throw new RequestError('Phone number is too long.');
    return { contact: await findContactByPhone(db, ctx.accountId, phone) };
  });
}
