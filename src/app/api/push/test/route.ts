// ============================================================
// POST /api/push/test — send a test push (debug / verification aid).
//
// Body: { title?, body?, sendToAll?, userId? }
//   - sendToAll:true → every active subscription in the caller's account
//   - userId:<uuid>  → that user's active subscriptions (same account)
//   - neither        → the caller's own devices
//
// Account-scoped: a caller can only ever reach subscriptions inside
// their own account. Requires the 'agent' role or higher.
//
// In production the real notifications are sent automatically by the
// WhatsApp webhook; this route exists to validate the pipeline.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import {
  sendToSubscriptions,
  type StoredSubscription,
} from "@/lib/push/web-push";

export const runtime = "nodejs";

interface TestBody {
  title?: string;
  body?: string;
  sendToAll?: boolean;
  userId?: string;
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const payload = (await request.json().catch(() => ({}))) as TestBody;

    let query = supabaseAdmin()
      .from("push_subscriptions")
      .select("id, endpoint, p256dh_key, auth_key")
      .eq("account_id", ctx.accountId)
      .eq("active", true);

    if (!payload.sendToAll) {
      // Targeted (userId) or self.
      query = query.eq("user_id", payload.userId ?? ctx.userId);
    }

    const { data: subs, error } = await query;

    if (error) {
      console.error("[POST /api/push/test] load error:", error);
      return NextResponse.json(
        { error: "Failed to load subscriptions" },
        { status: 500 },
      );
    }

    if (!subs || subs.length === 0) {
      return NextResponse.json({ sent: 0, details: [] });
    }

    const details = await sendToSubscriptions(subs as StoredSubscription[], {
      title: payload.title?.trim() || "Test notification",
      body: payload.body?.trim() || "Web push is working 🎉",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      url: "/inbox",
      tag: "wacrm-test",
      requireInteraction: false,
    });

    const sent = details.filter((d) => d.success).length;
    return NextResponse.json({ sent, details });
  } catch (err) {
    return toErrorResponse(err);
  }
}
