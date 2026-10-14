import { getPool } from '@/lib/db/pool';
import { peekInvitation } from '@/lib/db/invitations';
import { localErrorResponse } from '@/lib/api/local-route';
import {
  checkRateLimit,
  RATE_LIMITS,
  rateLimitResponse,
} from '@/lib/rate-limit';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'local';
  const limit = checkRateLimit(`peek:${ip}`, RATE_LIMITS.invitationPeek);
  if (!limit.success) return rateLimitResponse(limit);
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    return Response.json({ ok: false, reason: 'not_found' });
  try {
    // This narrowly scoped SECURITY DEFINER function reveals only invitation metadata.
    const result = await peekInvitation(getPool(), token);
    return Response.json(result, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return localErrorResponse(error);
  }
}
