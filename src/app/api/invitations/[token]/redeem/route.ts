import { accountRoute, RequestError } from '@/lib/api/local-route';
import { redeemInvitation } from '@/lib/db/invitations';
import {
  checkRateLimit,
  RATE_LIMITS,
  rateLimitResponse,
} from '@/lib/rate-limit';

export function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'local';
  const limit = checkRateLimit(`redeem:${ip}`, RATE_LIMITS.invitationRedeem);
  if (!limit.success) return rateLimitResponse(limit);
  return accountRoute(request, 'viewer', async (db) => {
    const { token } = await params;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new RequestError('Invalid invitation token.');
    return { ok: true, accountId: await redeemInvitation(db, token) };
  });
}
