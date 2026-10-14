import {
  assertSameOrigin,
  localErrorResponse,
  RequestError,
} from '@/lib/api/local-route';
import {
  getLocalAccountContext,
  withAccount,
  type LocalAccountContext,
} from '@/lib/db/context';
import { hasMinRole, type AccountRole } from '@/lib/auth/roles';
import { AiError } from './types';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import type { SqlConnection } from '@/lib/db/transaction';
import type { AiSqlRunner } from './knowledge';
export interface AiRouteContext extends LocalAccountContext {
  run: AiSqlRunner;
  db: SqlConnection;
}
/** No SQL lease is held while an external AI provider is running. */
export async function aiRoute(
  request: Request,
  minimum: AccountRole,
  work: (ctx: AiRouteContext) => Promise<unknown>
) {
  try {
    assertSameOrigin(request);
    const context = await getLocalAccountContext();
    if (!hasMinRole(context.role, minimum))
      throw new RequestError('Insufficient permissions.', 403);
    if (request.method !== 'GET') {
      const limit = checkRateLimit(
        `ai:${new URL(request.url).pathname}:${context.userId}`,
        minimum === 'admin' ? RATE_LIMITS.adminAction : RATE_LIMITS.aiDraft
      );
      if (!limit.success)
        throw new RequestError('Too many requests. Try again shortly.', 429);
    }
    const run: AiSqlRunner = (work) =>
      withAccount(context, async (db) => {
        // Recheck role as well as membership before every database operation.
        const { rows } = await db.query(
          'SELECT account_role FROM public.profiles WHERE user_id=$1 AND account_id=$2',
          [context.userId, context.accountId]
        );
        if (!rows[0] || !hasMinRole(rows[0].account_role, minimum))
          throw new RequestError('Insufficient permissions.', 403);
        return work(db);
      });
    const db: SqlConnection = {
      query: (sql, values) =>
        run((connection) => connection.query(sql, values)),
    };
    return Response.json(await work({ ...context, run, db }), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof AiError)
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    return localErrorResponse(error);
  }
}
