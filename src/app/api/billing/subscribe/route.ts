import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  ForbiddenError,
  PaymentRequiredError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from "@/lib/auth/account";
import { cancelSubscription, createCustomer, createSubscription } from "@/lib/billing/asaas";

function admin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Amanhã, ou o fim do trial se ele terminar depois — nunca cobra
 * antes do trial grátis de 7 dias acabar (spec §1). */
function firstChargeDate(trialEndsAt: string | null): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (!trialEndsAt) return tomorrow.toISOString().slice(0, 10);
  const trialEnd = new Date(trialEndsAt);
  return (trialEnd > tomorrow ? trialEnd : tomorrow).toISOString().slice(0, 10);
}

export async function POST() {
  try {
    // allowBlocked: quem já está bloqueado precisa conseguir assinar
    // pra se desbloquear — senão fica trancado sem saída.
    const ctx = await requireRole("owner", { allowBlocked: true });

    // Já existe uma assinatura no Asaas pra essa conta? Cancela antes
    // de criar outra — sem isso, clicar em "Assinar agora" de novo
    // (ex.: depois de past_due) cria uma SEGUNDA assinatura no Asaas,
    // que nunca é cancelada e cobra o cliente duas vezes pra sempre.
    if (ctx.account.asaas_subscription_id) {
      await cancelSubscription(ctx.account.asaas_subscription_id);
    }

    let customerId = ctx.account.asaas_customer_id;
    if (!customerId) {
      const created = await createCustomer(ctx.account.name, undefined);
      customerId = created.customerId;
    }

    const { subscriptionId, invoiceUrl } = await createSubscription(
      customerId,
      `Assinatura wacrm — ${ctx.account.name}`,
      firstChargeDate(ctx.account.trial_ends_at)
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
    if (
      err instanceof UnauthorizedError ||
      err instanceof ForbiddenError ||
      err instanceof PaymentRequiredError
    ) {
      return toErrorResponse(err);
    }
    // Anything else (Asaas call failed, config missing, etc.) — log
    // the real detail server-side, but never put it on the wire (same
    // rule as toErrorResponse's own uncategorized-error branch).
    console.error("[billing subscribe] failed", err);
    return NextResponse.json({ error: "Failed to start subscription" }, { status: 502 });
  }
}
