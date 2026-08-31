// ============================================================
// GET /api/v1/me — public API identity probe.
//
// The reference endpoint for the public API: it requires nothing
// but a valid key (no scope), and returns the account the key is
// bound to plus the scopes it carries. Integrators use it to verify
// their key works and to discover what it's allowed to do before
// wiring up real calls.
//
// It also exercises the entire public-API stack end to end — bearer
// parse → hash lookup → liveness → rate limit → envelope — so a
// green response here means the plumbing every future endpoint
// depends on is sound.
// ============================================================

import { withApiKey } from '@/lib/auth/api-context';
import { getAccountName } from '@/lib/api-keys/store';
import { ok } from '@/lib/api/v1/respond';

export async function GET(request: Request) {
  return withApiKey(request, undefined, async (ctx) => {
    const name = await getAccountName(ctx.accountId);
    return ok({
      account: { id: ctx.accountId, name },
      key: { id: ctx.keyId, scopes: ctx.scopes },
    });
  });
}
