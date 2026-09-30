// ============================================================
// GET /api/partners — the caller's Partners (SubUsers + invitations).
//
// Main Users only (`requireMainUser`) → SubUsers get 403. Scoped to
// the authenticated user's id; the route takes no owner parameter.
// ============================================================

import { NextResponse } from "next/server";

import { requireMainUser, toErrorResponse } from "@/lib/auth/account";
import { listPartners, partnersDb } from "@/lib/partners/server";

export async function GET() {
  try {
    const ctx = await requireMainUser();
    const partners = await listPartners(partnersDb(), ctx.userId);
    return NextResponse.json({ partners });
  } catch (err) {
    return toErrorResponse(err);
  }
}
