import { accountRoute, readObject, RequestError } from '@/lib/api/local-route';
import { listKeys, mintKey } from '@/lib/db/api-keys';
import { normalizeScopes } from '@/lib/api-keys/scopes';

export function GET(request: Request) {
  return accountRoute(request, 'viewer', async (db, ctx) => ({
    keys: await listKeys(db, ctx.accountId),
  }));
}
export function POST(request: Request) {
  return accountRoute(request, 'admin', async (db, ctx) => {
    const body = await readObject(request);
    if (
      typeof body.name !== 'string' ||
      !body.name.trim() ||
      body.name.trim().length > 80
    )
      throw new RequestError('Name must contain 1–80 characters.');
    const scopes = normalizeScopes(body.scopes ?? []);
    if (!scopes) throw new RequestError('Provide known API scope names.');
    let expiresAt: Date | null = null;
    if (
      typeof body.expiresInDays === 'number' &&
      Number.isFinite(body.expiresInDays) &&
      body.expiresInDays > 0
    ) {
      expiresAt = new Date(
        Date.now() +
          Math.max(1, Math.min(365, Math.floor(body.expiresInDays))) * 86400000
      );
    }
    return mintKey(db, ctx.userId, {
      name: body.name.trim(),
      scopes,
      expiresAt,
    });
  });
}
