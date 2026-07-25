/**
 * Shared per-key rate limiter.
 *
 * The fixed-window counter lives in Postgres behind an atomic RPC, so
 * every application instance and region consumes the same bucket.
 * Raw identifiers are SHA-256 hashed before storage.
 */

import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export interface RateLimitOptions {
  /** Max requests allowed in `windowMs`. */
  limit: number;
  /** Window size, milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  success: boolean;
  /** True when the shared limiter could not make a decision. */
  unavailable?: boolean;
  /** Requests still allowed in the current window. */
  remaining: number;
  /** Unix ms when the bucket refills. */
  reset: number;
  limit: number;
}

interface RateLimitRpcRow {
  success: boolean;
  remaining: number;
  reset_at: string;
  bucket_limit: number;
}

export async function checkRateLimit(
  key: string,
  { limit, windowMs }: RateLimitOptions,
): Promise<RateLimitResult> {
  if (
    key.length === 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 1_000_000 ||
    !Number.isInteger(windowMs) ||
    windowMs < 1 ||
    windowMs > 86_400_000
  ) {
    throw new Error('Invalid distributed rate limit configuration');
  }

  const bucketHash = createHash('sha256').update(key, 'utf8').digest('hex');
  let data: unknown;
  let error: unknown;
  try {
    const result = await supabaseAdmin().rpc('claim_rate_limit_slot', {
      p_bucket_hash: bucketHash,
      p_limit: limit,
      p_window_ms: windowMs,
    });
    data = result.data;
    error = result.error;
  } catch {
    return unavailableResult(limit);
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | RateLimitRpcRow
    | null;
  const reset = row ? Date.parse(row.reset_at) : Number.NaN;

  if (
    error ||
    !row ||
    typeof row.success !== 'boolean' ||
    !Number.isInteger(row.remaining) ||
    row.remaining < 0 ||
    row.bucket_limit !== limit ||
    !Number.isFinite(reset)
  ) {
    return unavailableResult(limit);
  }

  return {
    success: row.success,
    remaining: row.remaining,
    reset,
    limit: row.bucket_limit,
  };
}

/**
 * Standard 429 response with the headers clients expect (RFC 6585 +
 * draft-ietf-httpapi-ratelimit-headers). Callers just `return` this.
 */
export function rateLimitResponse(result: RateLimitResult): NextResponse {
  if (result.unavailable) {
    return NextResponse.json(
      {
        error: 'Rate limit service unavailable',
        code: 'rate_limit_unavailable',
      },
      { status: 503, headers: { 'Retry-After': '1' } },
    );
  }

  const retryAfterSec = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
  return NextResponse.json(
    {
      error: 'Rate limit exceeded',
      retry_after_seconds: retryAfterSec,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSec),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.ceil(result.reset / 1000)),
      },
    },
  );
}

/** Preconfigured budgets, tweak here not at call sites. */
export const RATE_LIMITS = {
  /** Individual message send. 60/min per user = one per second
   *  sustained, comfortable for a live human typing. */
  send: { limit: 60, windowMs: 60_000 },
  /** Broadcast dispatch. 5/min per user — even a 1 000-recipient
   *  broadcast is one call; this caps the rate at which a single user
   *  can launch campaigns, not the messages inside one. */
  broadcast: { limit: 5, windowMs: 60_000 },
  /** Reaction add/swap/remove. More permissive than send — users
   *  fidget with reactions and a single "swap" is actually two calls
   *  (remove + add) under the hood. */
  react: { limit: 120, windowMs: 60_000 },
  /** Invitation peek (public, per-IP). 30/min lets a forwarded link
   *  retry a handful of times under flaky connectivity without
   *  enabling brute-force token enumeration. With 256-bit tokens the
   *  enumeration risk is theoretical; this is belt-and-braces. */
  invitationPeek: { limit: 30, windowMs: 60_000 },
  /** Invitation redeem (authed, per-IP+user). Tighter than peek —
   *  successful redemption mutates two profiles and an invite row, so
   *  the abuse surface is "spam join attempts." */
  invitationRedeem: { limit: 10, windowMs: 60_000 },
  /** Admin-only account / member-management actions: create/revoke
   *  invitation, rename account, change member role, remove member,
   *  transfer ownership. 30/min per user is comfortably above any
   *  realistic legitimate use (the Members tab is a clicks-only UI)
   *  while still bounding accidental abuse from a script run in a
   *  loop or a compromised admin session spamming role flips. */
  adminAction: { limit: 30, windowMs: 60_000 },
  /** Public REST API (`/api/v1/*`), keyed per API key. 120/min ≈ 2
   *  req/s sustained — comfortable for a polling integration or an
   *  automation firing on inbound events, while bounding a runaway
   *  script. */
  publicApi: { limit: 120, windowMs: 60_000 },
  /** AI agent decision per inbound WhatsApp message. Keyed per account
   *  (not per user — the webhook has no authenticated user). 30/min
   *  comfortably covers a busy inbox without runaway BYOK spend from a
   *  misbehaving upstream retry storm. */
  aiAgentDecision: { limit: 30, windowMs: 60_000 },
  /** Automation copilot turn. Human-paced ("type a message, wait for a
   *  reply"), keyed per user. 20/min matches the existing click-paced
   *  AI-action buckets' shape in this file. */
  aiCopilot: { limit: 20, windowMs: 60_000 },
} as const;

function unavailableResult(limit: number): RateLimitResult {
  return {
    success: false,
    unavailable: true,
    remaining: 0,
    reset: Date.now() + 1_000,
    limit,
  };
}
