// ============================================================
// POST   /api/push/subscribe  — register/refresh this device's push
//                               subscription for the logged-in user.
// DELETE /api/push/subscribe  — deactivate a subscription by endpoint.
//
// The browser builds the subscription (endpoint + p256dh + auth) via
// PushManager; we persist it tied to the caller's user_id + account_id
// so the webhook can target the right people. Upsert on `endpoint` so
// re-subscribing the same browser updates keys / re-activates instead
// of duplicating.
//
// Node runtime (no web-push here, but we keep parity with the sender).
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";

export const runtime = "nodejs";

interface SubscribeBody {
  endpoint?: string;
  p256dh?: string;
  auth?: string;
  userAgent?: string;
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const body = (await request.json().catch(() => ({}))) as SubscribeBody;

    if (!body.endpoint || !body.p256dh || !body.auth) {
      return NextResponse.json(
        { error: "endpoint, p256dh and auth are required" },
        { status: 400 },
      );
    }

    // Upsert by endpoint (unique). Using the service-role client so a
    // re-subscribe whose endpoint was previously owned by another user
    // (shared device) re-binds cleanly to the current caller.
    const { error } = await supabaseAdmin()
      .from("push_subscriptions")
      .upsert(
        {
          account_id: ctx.accountId,
          user_id: ctx.userId,
          endpoint: body.endpoint,
          p256dh_key: body.p256dh,
          auth_key: body.auth,
          user_agent: body.userAgent ?? null,
          active: true,
          updated_at: new Date().toISOString(),
          last_used_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" },
      );

    if (error) {
      console.error("[POST /api/push/subscribe] upsert error:", error);
      return NextResponse.json(
        { error: "Failed to save subscription" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const body = (await request.json().catch(() => ({}))) as { endpoint?: string };

    if (!body.endpoint) {
      return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
    }

    // Scope the deactivation to the caller's own row.
    const { error } = await supabaseAdmin()
      .from("push_subscriptions")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("endpoint", body.endpoint)
      .eq("user_id", ctx.userId);

    if (error) {
      console.error("[DELETE /api/push/subscribe] update error:", error);
      return NextResponse.json(
        { error: "Failed to remove subscription" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
