// ============================================================
// POST /api/billing/webhook/asaas
//
// O Asaas chama isso a cada mudança de status de pagamento. Nome
// exato do header de auth (asaas-access-token) e dos nomes de
// evento — confirmar na prática contra um webhook real do sandbox
// antes de considerar isto pronto pra produção (mesmo espírito do
// "confirmar na prática" da integração UAZAPI). O mapeamento de
// PAYMENT_DELETED → "canceled" é a melhor aproximação disponível
// pra "evento de assinatura cancelada/deletada" (spec §3.6.3) até
// confirmar contra um payload real do sandbox.
// ============================================================

import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function admin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type Json = Record<string, unknown>;

const EVENT_TO_STATUS: Record<string, string> = {
  PAYMENT_CONFIRMED: "active",
  PAYMENT_RECEIVED: "active",
  PAYMENT_OVERDUE: "past_due",
  PAYMENT_DELETED: "canceled",
};

export async function POST(request: Request) {
  const expected = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!expected) {
    return NextResponse.json({ status: "not configured" }, { status: 503 });
  }
  // Constant-time compare so an attacker who can hit this endpoint
  // can't recover the token byte-by-byte from response-time deltas
  // (same pattern as src/app/api/flows/cron/route.ts). Length
  // pre-check is required by timingSafeEqual (throws otherwise) and
  // leaks only the length itself, which isn't sensitive.
  const supplied = request.headers.get("asaas-access-token") ?? "";
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    console.warn("[asaas webhook] invalid or missing token");
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as Json;
  const event = String(payload.event ?? "");
  const newStatus = EVENT_TO_STATUS[event];

  if (!newStatus) {
    console.info("[asaas webhook] unhandled event:", event);
    return NextResponse.json({ status: "ignored" }, { status: 200 });
  }

  const payment = (payload.payment as Json | undefined) ?? {};
  const subscriptionId = payment.subscription as string | undefined;
  if (!subscriptionId) {
    console.warn("[asaas webhook] payload missing payment.subscription", event);
    return NextResponse.json({ status: "ignored" }, { status: 200 });
  }

  const db = admin();

  const { data: account, error: findErr } = await db
    .from("accounts")
    .select("id")
    .eq("asaas_subscription_id", subscriptionId)
    .maybeSingle();

  if (findErr) {
    console.error("[asaas webhook] account lookup failed:", findErr);
    return NextResponse.json({ status: "error" }, { status: 500 });
  }

  if (!account) {
    console.warn("[asaas webhook] no account found for subscription:", subscriptionId);
    return NextResponse.json({ status: "ignored" }, { status: 200 });
  }

  const { error } = await db
    .from("accounts")
    .update({ subscription_status: newStatus, subscription_updated_at: new Date().toISOString() })
    .eq("id", (account as { id: string }).id);

  if (error) {
    console.error("[asaas webhook] account UPDATE failed:", error);
    return NextResponse.json({ status: "error" }, { status: 500 });
  }

  return NextResponse.json({ status: "received" }, { status: 200 });
}
