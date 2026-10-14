import { accountRoute, readObject, RequestError } from '@/lib/api/local-route';
import { listPresence, touchPresence } from '@/lib/db/member-status';
export function GET(request: Request) {
  return accountRoute(request, 'viewer', async (db, ctx) => ({
    presence: await listPresence(db, ctx.accountId),
  }));
}
export function POST(request: Request) {
  return accountRoute(request, 'viewer', async (db) => {
    const { status } = await readObject(request);
    if (status !== 'online' && status !== 'away')
      throw new RequestError('Invalid presence status.');
    await touchPresence(db, status);
    return { ok: true };
  });
}
