// ============================================================
// Public API (v1) response envelope.
//
// Every `/api/v1/*` route speaks one shape so external integrators
// can write a single response parser:
//
//   success → { "data": <payload> }
//   failure → { "error": { "code": "<machine_code>", "message": "<human>" } }
//
// `code` is a stable, machine-matchable string (clients branch on
// it); `message` is human-facing and may be reworded freely. This is
// intentionally distinct from the internal `{ error: string }` shape
// used by the dashboard's own `/api/*` routes — the public contract
// is versioned and shouldn't inherit internal wording changes.
// ============================================================

import { NextResponse } from 'next/server';
import type { RateLimitResult } from '@/lib/rate-limit';

export type ApiErrorCode =
  | 'unauthorized' // missing / malformed / unknown / revoked / expired key
  | 'forbidden' // valid key, but missing the required scope
  | 'rate_limited' // per-key budget exhausted
  | 'bad_request' // malformed input
  | 'not_found'
  | 'internal';

/**
 * Typed error a route (or `requireApiKey`) can throw and have mapped
 * to the envelope by `toApiErrorResponse`. Carries an HTTP status, a
 * machine code, and optional extra headers (used for the rate-limit
 * `Retry-After` / `X-RateLimit-*` set).
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly headers?: Record<string, string>;

  constructor(
    code: ApiErrorCode,
    message: string,
    status: number,
    headers?: Record<string, string>
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.headers = headers;
  }
}

/** 401 — no usable credential. */
export function unauthorized(message = 'Missing or invalid API key'): ApiError {
  return new ApiError('unauthorized', message, 401);
}

/** 403 — authenticated, but the key lacks the scope this route needs. */
export function forbidden(message: string): ApiError {
  return new ApiError('forbidden', message, 403);
}

/** 400 — bad input. */
export function badRequest(message: string): ApiError {
  return new ApiError('bad_request', message, 400);
}

/** 429 — built from a `checkRateLimit` miss, with the standard headers. */
export function rateLimited(result: RateLimitResult): ApiError {
  const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
  return new ApiError(
    'rate_limited',
    'Rate limit exceeded for this API key',
    429,
    {
      'Retry-After': String(retryAfter),
      'X-RateLimit-Limit': String(result.limit),
      'X-RateLimit-Remaining': String(result.remaining),
      'X-RateLimit-Reset': String(Math.ceil(result.reset / 1000)),
    }
  );
}

/** Success envelope: `{ data: <payload> }`. */
export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data }, { status });
}

/**
 * List envelope: `{ data: [...], meta: { next_cursor } }`. The `meta`
 * block is the pagination contract shared by every v1 list endpoint —
 * `next_cursor` is an opaque string to pass back as `?cursor=`, or
 * `null` on the last page. See `src/lib/api/v1/pagination.ts`.
 */
export function okList<T>(items: T[], nextCursor: string | null): NextResponse {
  return NextResponse.json({ data: items, meta: { next_cursor: nextCursor } });
}

/**
 * Failure envelope from an explicit (code, message, status). Use for
 * domain errors whose codes live outside `ApiErrorCode` (e.g. the
 * send pipeline's `meta_error` / `whatsapp_not_configured`) — the
 * wire `code` is a free string, so any machine-meaningful value is
 * fine. `headers` is rarely needed; omit unless you have a
 * `Retry-After`-style set.
 */
export function fail(
  code: string,
  message: string,
  status: number,
  headers?: Record<string, string>
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

/**
 * Map any thrown value to the failure envelope. `ApiError` keeps its
 * code/status/headers; anything else collapses to a generic 500 so we
 * never leak internal error text onto the public wire.
 */
export function toApiErrorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status, headers: err.headers }
    );
  }
  console.error('[api/v1] uncategorized error:', err);
  return NextResponse.json(
    { error: { code: 'internal', message: 'Internal server error' } },
    { status: 500 }
  );
}
