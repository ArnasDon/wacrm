import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { getT } from "@/lib/i18n/translate";

const t = getT("Api");

export async function POST() {
  try {
    const ctx = await getCurrentAccount();

    const limit = checkRateLimit(
      `account:leave:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    if (ctx.role === "owner") {
      return NextResponse.json(
        { error: t("account.leave.ownerCannotLeave") },
        { status: 400 },
      );
    }

    const { data, error } = await ctx.supabase.rpc("leave_account");

    if (error) {
      if (error.code === "22023") {
        return NextResponse.json(
          { error: t("account.leave.ownerCannotLeave") },
          { status: 400 },
        );
      }
      if (error.code === "42501") {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
      console.error("[POST /api/account/leave] unexpected RPC error:", error);
      return NextResponse.json(
        { error: t("account.leave.failed") },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, newPersonalAccountId: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
