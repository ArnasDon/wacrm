// ============================================================
// POST /api/account/transfer-ownership
//
// Owner only. Atomically:
//   - demotes the current owner to 'admin'
//   - promotes the target member to 'owner'
//   - updates accounts.owner_user_id
//
// The atomic part lives in the `transfer_account_ownership`
// SECURITY DEFINER RPC (migration 018). This route just validates
// shape and forwards.
//
// Why a separate endpoint instead of PATCH /members/[userId]?
//   The semantics differ: transfer demotes the current owner as
//   a side-effect and changes the owner_user_id pointer on
//   `accounts`. Making it explicit prevents the "I clicked the
//   role dropdown by mistake" failure mode where an admin would
//   silently hand their account away.
// ============================================================

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err.code === "22023") {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error("[transfer-ownership] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Failed to transfer ownership" },
    { status: 500 },
  );
}

// Crude shape check — full UUID validation happens DB-side when
// the FK / lookup runs. This guards against obviously-wrong input
// (numbers, objects) before we round-trip.
function looksLikeUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

export async function POST(request: Request) {
  try {
    // `requireRole('owner')` is belt-and-braces — the RPC checks
    // this too, but failing fast here saves a Supabase round trip
    // on the obvious "admin trying to transfer" case.
    const ctx = await requireRole("owner");

    // Rate-limit owner-only transfers. Legitimate use is one click
    // every few months at most; a script run in a loop would
    // produce a noisy audit trail. 30/min is well above any human
    // pace and bounds the noise.
    const limit = checkRateLimit(
      `admin:transferOwnership:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { newOwnerUserId?: unknown }
      | null;
    const newOwnerUserId = body?.newOwnerUserId;

    if (!looksLikeUuid(newOwnerUserId)) {
      return NextResponse.json(
        { error: "'newOwnerUserId' must be a valid UUID" },
        { status: 400 },
      );
    }

    const { error } = await ctx.supabase.rpc("transfer_account_ownership", {
      p_new_owner_user_id: newOwnerUserId,
    });

    if (error) return rpcErrorToResponse(error);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
