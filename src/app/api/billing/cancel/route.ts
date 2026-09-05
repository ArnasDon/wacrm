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
    const { error } = await db
      .from("accounts")
      .update({
        subscription_status: "canceled",
        // Zera o id da assinatura: sem isso, um webhook atrasado (um
        // PIX/boleto que compensa segundos depois do cancelamento, ou
        // um retry do Asaas de uma entrega antiga) ainda acha essa
        // conta por asaas_subscription_id e reativa o acesso sozinho.
        asaas_subscription_id: null,
        subscription_updated_at: new Date().toISOString(),
      })
      .eq("id", ctx.accountId);

    if (error) {
      console.error("[POST /api/billing/cancel] update error:", error);
      return NextResponse.json(
        { error: "Failed to cancel subscription" },
        { status: 500 }
      );
    }

    return NextResponse.json({ status: "canceled" });
  } catch (err) {
    return toErrorResponse(err);
  }
}
