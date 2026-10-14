import { accountRoute, readObject } from '@/lib/api/local-route';
import {
  parseAudience,
  resolveBroadcastAudience,
} from '@/lib/db/broadcast-audience';
export function POST(request: Request) {
  return accountRoute(request, 'viewer', async (db, ctx) => {
    const audience = parseAudience(await readObject(request));
    if (audience.type === 'csv')
      return { count: audience.csvContacts?.length ?? 0 };
    return {
      count: (await resolveBroadcastAudience(db, ctx.accountId, audience))
        .length,
    };
  });
}
