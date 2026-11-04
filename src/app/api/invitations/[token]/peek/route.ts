// ============================================================
// GET /api/invitations/[token]/peek
//
// Public — no auth required. Lets the /join/<token> page render
// "You're being invited to <Account> as <Role>" before the
// visitor signs up or signs in.
//
// Security model
//   - Token is in the URL path, not the query, so it doesn't
//     show up in standard access-log "referer" fields the way a
//     `?token=` would.
//   - The plaintext token never crosses the DB boundary — we
//     hash it in TS first and look up by `token_hash`.
//   - The peek RPC is SECURITY DEFINER so it bypasses the RLS
//     that would otherwise block an anonymous SELECT on
//     `account_invitations`. It returns a fixed-shape JSON
//     payload that never leaks columns beyond what the join
//     page renders.
//   - Per-IP rate limit pinches brute-force enumeration of
//     tokens. With 256 bits of entropy the enumeration risk is
//     theoretical, but rate limiting is cheap insurance.
// ============================================================

import { NextResponse } from "next/server";

import { hashInviteToken } from "@/lib/auth/invitations";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  // Rate-limit by IP first. Returns 429 to a serial bruteforcer
  // before we ever touch the DB.
  const ip = getClientIp(request);
  const limit = checkRateLimit(`peek:${ip}`, RATE_LIMITS.invitationPeek);
  if (!limit.success) return rateLimitResponse(limit);

  const { token } = await params;
  if (!token || typeof token !== "string") {
    return NextResponse.json(
      { ok: false, reason: "not_found" },
      { status: 404 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("peek_invitation", {
    p_token_hash: hashInviteToken(token),
  });

  if (error) {
    console.error("[peek] rpc error:", error);
    return NextResponse.json(
      { ok: false, reason: "server_error" },
      { status: 500 },
    );
  }

  // The RPC always returns a json object — either ok:true with
  // metadata or ok:false with a reason. Forward verbatim.
  return NextResponse.json(data);
}
