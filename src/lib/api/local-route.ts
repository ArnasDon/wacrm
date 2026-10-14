import type { PoolClient } from 'pg';
import { getLocalAccountContext, withAccount, type LocalAccountContext } from '@/lib/db/context';
import { hasMinRole, type AccountRole } from '@/lib/auth/roles';
import { SessionRequiredError } from '@/lib/auth/session';
import { MembershipRequiredError } from '@/lib/db/context-core';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export class RequestError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export function localErrorResponse(error: unknown): Response {
  if (error instanceof RequestError || error instanceof SessionRequiredError || error instanceof MembershipRequiredError) {
    return Response.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'private, no-store' } });
  }
  const code = (error as { code?: unknown })?.code;
  const status = code === 'P0002' ? 404 : code === '42501' ? 403 : code === '23505' ? 409 : code === '22023' || code === '22P02' || code === '23514' ? 400 : 500;
  const message = status === 404 ? 'Record not found.' : status === 403 ? 'Insufficient permissions.' : status === 409 ? 'This record already exists.' : status === 400 ? 'Invalid request.' : 'Unable to complete this request.';
  // PostgreSQL error objects may contain sensitive query values.
  console.error('[local-api] Request failed', typeof code === 'string' ? code : 'internal');
  return Response.json({ error: message }, { status });
}

export function assertSameOrigin(request: Request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const origin = request.headers.get('origin');
  const expected = new URL(process.env.BETTER_AUTH_URL ?? request.url).origin;
  if (!origin || origin !== expected) throw new RequestError('Untrusted request origin.', 403);
}

export async function accountRoute<T>(request: Request, minimum: AccountRole, work: (db: PoolClient, context: LocalAccountContext) => Promise<T>, afterCommit?: (result: T, context: LocalAccountContext) => Promise<void>): Promise<Response> {
  try {
    assertSameOrigin(request);
    const context = await getLocalAccountContext();
    if (!hasMinRole(context.role, minimum)) throw new RequestError('Insufficient permissions.', 403);
    if (!['GET', 'HEAD'].includes(request.method) && (minimum === 'admin' || minimum === 'owner')) {
      const limit = checkRateLimit(`local-admin:${new URL(request.url).pathname}:${context.userId}`, RATE_LIMITS.adminAction);
      if (!limit.success) throw new RequestError('Too many requests. Try again shortly.', 429);
    }
    const result = await withAccount(context, db => work(db, context));
    if (afterCommit) await afterCommit(result, context);
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return localErrorResponse(error); }
}

export async function readObject(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError('A JSON object is required.');
  return value;
}

export function requireUUID(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new RequestError('Invalid record identifier.');
  return value;
}
