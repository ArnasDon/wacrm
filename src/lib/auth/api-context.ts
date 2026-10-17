// ============================================================
// Public API authentication — resolve a request's API key into an
// account context.
//
// This is the machine-to-machine counterpart of `getCurrentAccount`
// (cookie session → account). Where the dashboard authenticates a
// human via Supabase cookies, the public API authenticates a caller
// via `Authorization: Bearer wacrm_live_…`.
//
// Calling convention — every `/api/v1` route does:
//
//   try {
//     const ctx = await requireApiKey(request, "messages:send");
//     // ctx.supabase   — service-role client (no user session exists)
//     // ctx.accountId  — the key's account; scope every query by it
//     // ctx.scopes     — granted scopes
//     // ctx.keyId      — for logging / the rate-limit bucket
//   } catch (err) {
//     return toApiErrorResponse(err);   // maps ApiError → envelope
//   }
//
// Why a service-role client: an API caller has no Supabase session,
// so there's no `auth.uid()` for RLS to match. The key lookup itself
// establishes the account; from there every downstream query MUST be
// explicitly filtered by `ctx.accountId` (the same discipline the
// dashboard's send route already follows). The key never escalates
// past its own account because the account is fixed at lookup time.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { after } from 'next/server';
import type { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { findActiveKeyByHash, touchLastUsed } from '@/lib/api-keys/store';
import { hashApiKey, looksLikeApiKey } from '@/lib/api-keys/keys';
import { hasScope, type ApiScope } from '@/lib/api-keys/scopes';
import {
  forbidden,
  rateLimited,
  unauthorized,
  toApiErrorResponse,
} from '@/lib/api/v1/respond';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logApiRequest } from '@/lib/api/v1/audit-log';

export interface ApiKeyContext {
  /** Discriminant — lets shared logic tell key auth from cookie auth. */
  authType: 'api_key';
  /** Service-role Supabase client. RLS-bypassing; scope by accountId. */
  supabase: SupabaseClient;
  /** The account this key belongs to. */
  accountId: string;
  /** The key row id — for audit logging and the rate-limit bucket. */
  keyId: string;
  /** Scopes granted to this key. */
  scopes: string[];
  /** Who minted the key (null if that user was later removed). */
  createdBy: string | null;
}

/**
 * Extract the bearer token from the `Authorization` header.
 * Tolerates the `Bearer ` prefix being absent (some clients send the
 * bare key) but requires the value to look like one of our keys.
 */
function extractKey(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const value = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : header.trim();
  return value.length > 0 ? value : null;
}

/**
 * Authenticate a public-API request and (optionally) enforce a
 * single scope. Throws an `ApiError` (mapped to the envelope by
 * `toApiErrorResponse`) on any failure:
 *
 *   401 unauthorized — no key, malformed, unknown, revoked, expired
 *   403 forbidden    — valid key without the required scope
 *   429 rate_limited — per-key budget exhausted
 *
 * On success, bumps `last_used_at` (fire-and-forget) and returns the
 * account context.
 */
export async function requireApiKey(
  request: Request,
  scope?: ApiScope
): Promise<ApiKeyContext> {
  const presented = extractKey(request);
  if (!presented || !looksLikeApiKey(presented)) {
    throw unauthorized();
  }

  const row = await findActiveKeyByHash(hashApiKey(presented));
  if (!row) {
    // Covers unknown, revoked, and expired keys alike — we don't
    // distinguish them on the wire so a probe can't learn whether a
    // key ever existed.
    throw unauthorized();
  }

  // Rate-limit per key, before the scope check, so an unauthorized-
  // scope caller still can't hammer the endpoint for free.
  const limit = checkRateLimit(`apikey:${row.id}`, RATE_LIMITS.publicApi);
  if (!limit.success) {
    throw rateLimited(limit);
  }

  if (scope && !hasScope(row.scopes, scope)) {
    throw forbidden(`This API key is missing the '${scope}' scope`);
  }

  touchLastUsed(row.id);

  return {
    authType: 'api_key',
    supabase: supabaseAdmin(),
    accountId: row.account_id,
    keyId: row.id,
    scopes: row.scopes,
    createdBy: row.created_by,
  };
}

/**
 * Authenticate + run a public-API route handler, then log the request
 * (security audit finding API-N2). This is the single choke point all
 * 11 `/api/v1/*` routes call through, so every one of them gets
 * uniform audit-log coverage without repeating logging code per file.
 *
 * `handler` receives the resolved `ApiKeyContext` and returns the
 * route's normal `NextResponse` — everything a route did before this
 * fix (its own domain-error handling, `ok`/`fail`/`okList` calls)
 * stays exactly as it was, just moved inside this callback. Any error
 * `handler` throws that it doesn't handle itself is mapped by the same
 * `toApiErrorResponse` every route already used directly.
 *
 * The log write happens via `after()` (already used elsewhere in this
 * module for the broadcast fan-out) so it gets a real chance to finish
 * even in a short-lived serverless invocation, and is best-effort: see
 * `logApiRequest` — a failed write is only ever `console.warn`'d, never
 * thrown, so it can't affect the response the caller is waiting on.
 *
 * Logs `accountId: null, keyId: null` for a request that never
 * resolved a key at all (bad/missing/revoked/expired) — still a
 * useful signal ("someone hit this endpoint and failed auth") without
 * fabricating an account that was never established.
 */
export async function withApiKey(
  request: Request,
  scope: ApiScope | undefined,
  handler: (ctx: ApiKeyContext) => Promise<NextResponse>
): Promise<NextResponse> {
  const path = new URL(request.url).pathname;
  let accountId: string | null = null;
  let keyId: string | null = null;
  let response: NextResponse;

  try {
    const ctx = await requireApiKey(request, scope);
    accountId = ctx.accountId;
    keyId = ctx.keyId;
    response = await handler(ctx);
  } catch (err) {
    response = toApiErrorResponse(err);
  }

  after(() => {
    // Defensive: `logApiRequest` itself is already fire-and-forget
    // internally, but this guarantees a logging failure can NEVER
    // affect the caller — by the time `after()` runs the response is
    // already on its way regardless, but nothing here should ever be
    // allowed to throw uncaught.
    try {
      logApiRequest({
        accountId,
        keyId,
        method: request.method,
        path,
        status: response.status,
      });
    } catch (err) {
      console.warn('[api/v1] audit log dispatch failed:', err);
    }
  });

  return response;
}
