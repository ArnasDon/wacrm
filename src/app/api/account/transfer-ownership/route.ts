import { accountRoute, readObject, requireUUID } from '@/lib/api/local-route';
import { transferOwnership } from '@/lib/db/accounts';

export function POST(request: Request) {
  return accountRoute(request, 'owner', async (db) => {
    const body = await readObject(request);
    await transferOwnership(db, requireUUID(body.newOwnerUserId));
    return { ok: true };
  });
}
