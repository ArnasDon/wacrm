/**
 * In-memory per-key rate limiter.
 *
 * Fixed-window counter (not token bucket): every identifier gets a
 * fresh N-request budget each window. Simple, allocation-light, and
 * fine for a single-instance VPS — which is how forkers of this
 * template will usually deploy.
 *
 * Trade-off: a single Node process holds the Map, so horizontal scale
 * (multiple regions, multiple Hostinger nodes, Vercel serverless fan-
 * out) silently defeats the limit. If you scale beyond one instance,
 * swap the `check` implementation for Redis / Upstash / Cloudflare
 * Durable Objects keeping the same return shape. The call sites won't
 * change.
 *
 * Memory: entries are ~50 bytes each. With LIGHT_SWEEP below, expired
 * keys get cleared opportunistically on every ~1 000th call, so a
 * healthy instance stays in the low-MB range even with thousands of
 * distinct users. No background timer — works in serverless edge
 * runtimes that don't keep timers alive across requests.
 */

import { NextResponse } from 'next/server';

export interface RateLimitOptions {
  /** Max requests allowed in `windowMs`. */
  limit: number;
  /** Window size, milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  success: boolean;
  /** Requests still allowed in the current window. */
  remaining: number;
  /** Unix ms when the bucket refills. */
  reset: number;
  limit: number;
}

interface Entry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Entry>();

// Opportunistic cleanup. Running a sweep on every call would be
// quadratic; running it 1-in-N lets the Map self-drain without a
// background timer.
const LIGHT_SWEEP_EVERY = 1000;
let callsSinceSweep = 0;

function sweepExpired(now: number) {
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

export function checkRateLimit(
  key: string,
  { limit, windowMs }: RateLimitOptions,
): RateLimitResult {
  const now = Date.now();

  callsSinceSweep += 1;
  if (callsSinceSweep >= LIGHT_SWEEP_EVERY) {
    callsSinceSweep = 0;
    sweepExpired(now);
  }

  const entry = buckets.get(key);

  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, remaining: limit - 1, reset: now + windowMs, limit };
  }

  if (entry.count >= limit) {
    return { success: false, remaining: 0, reset: entry.resetAt, limit };
  }

  entry.count += 1;
  return {
    success: true,
    remaining: limit - entry.count,
    reset: entry.resetAt,
    limit,
  };
}

/**
 * Standard 429 response with the headers clients expect (RFC 6585 +
 * draft-ietf-httpapi-ratelimit-headers). Callers just `return` this.
 */
export function rateLimitResponse(result: RateLimitResult): NextResponse {
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
   *  script. Like every bucket here it's per-process; a multi-
   *  instance deploy needs the Redis swap described at the top of
   *  this file (the per-key call sites don't change). */
  publicApi: { limit: 120, windowMs: 60_000 },
  /** AI draft-reply generation, per user. 20/min is generous for an
   *  agent clicking "Draft with AI" while working a thread, and bounds
   *  spend on the account's own LLM key against an accidental
   *  hold-down / script. */
  aiDraft: { limit: 20, windowMs: 60_000 },
  /** AI draft-reply generation, per account. Caps the WHOLE team's
   *  draws on the one shared BYO provider key — without this, N agents
   *  each under their per-user limit could still stampede the account's
   *  key past the provider's own rate limit. 60/min ≈ three busy agents
   *  drafting flat-out. */
  aiDraftAccount: { limit: 60, windowMs: 60_000 },
  /** AI auto-reply generation, per account. The per-conversation cap
   *  (`auto_reply_max_per_conversation`) bounds one thread; this bounds
   *  the whole account across threads, so a burst of inbound from many
   *  customers at once can't run the BYO key past the provider's limit
   *  or the owner's budget. 30/min is generous for organic inbound while
   *  capping a stampede; excess inbounds simply don't get an auto-reply
   *  (they still land in the inbox for a human). */
  aiAutoReplyAccount: { limit: 30, windowMs: 60_000 },
} as const;

/** Test-only helper. Clears the in-memory state so unit tests don't
 *  leak buckets across files. Not wired up in production code. */
export function __resetRateLimitForTests() {
  buckets.clear();
  callsSinceSweep = 0;
}
