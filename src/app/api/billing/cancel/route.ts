import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { cancelSubscription } from "@/lib/billing/asaas";

function admin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST() {
  try {
    const ctx = await requireRole("owner", { allowBlocked: true });

    if (ctx.account.asaas_subscription_id) {
      await cancelSubscription(ctx.account.asaas_subscription_id);
    }

    const db = admin();
    await db
      .from("accounts")
      .update({
        subscription_status: "canceled",
        subscription_updated_at: new Date().toISOString(),
      })
      .eq("id", ctx.accountId);

    return NextResponse.json({ status: "canceled" });
  } catch (err) {
    return toErrorResponse(err);
  }
}
