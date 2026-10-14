import { assertSameOrigin, RequestError } from '@/lib/api/local-route';
import { getLocalAccountContext } from '@/lib/db/context';
import { hasMinRole } from '@/lib/auth/roles';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
export async function requireBroadcastSession(request: Request) {
  assertSameOrigin(request);
  const ctx = await getLocalAccountContext();
  if (!hasMinRole(ctx.role, 'agent'))
    throw new RequestError('Insufficient permissions.', 403);
  if (!checkRateLimit('broadcast:' + ctx.userId, RATE_LIMITS.broadcast).success)
    throw new RequestError('Too many requests. Try again shortly.', 429);
  return ctx;
}
