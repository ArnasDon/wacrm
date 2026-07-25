import { NextResponse } from "next/server";

import { isTwoFactorEnabledFlag } from "@/lib/auth-2fa";
import { query } from "@/lib/mysql";
import { sessionUserFromRequest } from "@/lib/session-token";

export async function GET(request: Request) {
  try {
    const sessionUser = await sessionUserFromRequest(request);
    if (!sessionUser) {
      return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
    }

    const rows = await query<{ two_factor_enabled?: number | boolean }>(
      "SELECT two_factor_enabled FROM users WHERE id = ? LIMIT 1",
      [sessionUser.id],
    );
    const enabled = isTwoFactorEnabledFlag(rows[0]?.two_factor_enabled);

    return NextResponse.json({
      data: { twoFactorEnabled: enabled },
      error: null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[GET /api/auth/two-factor] unexpected error:", err);
    return NextResponse.json({ error: { message } }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const sessionUser = await sessionUserFromRequest(request);
    if (!sessionUser) {
      return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
    }

    const body = await request.json();
    const enabled = Boolean(body.enabled);

    await query("UPDATE users SET two_factor_enabled = ? WHERE id = ?", [
      enabled ? 1 : 0,
      sessionUser.id,
    ]);

    if (!enabled) {
      await query("DELETE FROM auth_login_otps WHERE user_id = ?", [
        sessionUser.id,
      ]);
    }

    return NextResponse.json({
      data: { twoFactorEnabled: enabled },
      error: null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[POST /api/auth/two-factor] unexpected error:", err);
    return NextResponse.json({ error: { message } }, { status: 500 });
  }
}
