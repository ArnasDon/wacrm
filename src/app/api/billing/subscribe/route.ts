import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { createCustomer, createSubscription } from "@/lib/billing/asaas";

function admin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST() {
  try {
    // allowBlocked: quem já está bloqueado precisa conseguir assinar
    // pra se desbloquear — senão fica trancado sem saída.
    const ctx = await requireRole("owner", { allowBlocked: true });

    let customerId = ctx.account.asaas_customer_id;
    if (!customerId) {
      const created = await createCustomer(ctx.account.name, undefined);
      customerId = created.customerId;
    }

    const { subscriptionId, invoiceUrl } = await createSubscription(
      customerId,
      `Assinatura wacrm — ${ctx.account.name}`
    );

    const db = admin();
    const { error } = await db
      .from("accounts")
      .update({
        asaas_customer_id: customerId,
        asaas_subscription_id: subscriptionId,
        subscription_updated_at: new Date().toISOString(),
      })
      .eq("id", ctx.accountId);

    if (error) {
      console.error("[POST /api/billing/subscribe] update error:", error);
      return NextResponse.json(
        { error: "Failed to save subscription" },
        { status: 500 }
      );
    }

    return NextResponse.json({ invoiceUrl });
  } catch (err) {
    if (err instanceof Error && !("status" in err)) {
      console.error("[billing subscribe] failed", err);
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return toErrorResponse(err);
  }
}
