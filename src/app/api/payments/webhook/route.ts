// ============================================================
// /api/payments/webhook?account_id=<uuid>
//
// Provider-agnostic payment callback. Any gateway (Stripe, PayPal,
// Razorpay, a bespoke bank link…) can call this once the operator
// copies the URL + webhook secret from Settings → Payments and
// points their gateway at it.
//
// Authentication (either is sufficient):
//   - `x-wacrm-signature: sha256=<hex>`  — HMAC-SHA256 of the RAW
//     request body keyed with the account's webhook secret. The
//     secret is stored encrypted at rest and decrypted here.
//   - `x-wacrm-secret: <secret>`         — bearer fallback for
//     gateways that can't sign bodies (constant-time compared).
//
// Payload contract (any shape, resolved by lib/products/webhook.ts):
//   { "payment_reference": "wacrm_<order-id>", "status": "paid" }
// The order is matched by `payment_reference` (the idempotency key
// stamped at order creation). `status` is optional — a paid/absent
// status fulfils the order; a cancelled/failed status voids it.
//
// Public by design — middleware excludes webhooks. The signature
// check is the only gate.
// ============================================================

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { decrypt } from "@/lib/whatsapp/encryption";
import { setOrderStatus } from "@/lib/products/fulfill";
import {
  parseWebhookPayload,
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_SECRET_HEADER,
} from "@/lib/products/webhook";

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("account_id");
  if (!accountId) {
    return NextResponse.json({ error: "missing account_id" }, { status: 400 });
  }

  const rawBody = await request.text();
  if (!rawBody) {
    return NextResponse.json({ error: "empty body" }, { status: 400 });
  }
  const parsed = parseWebhookPayload(rawBody);
  if (!parsed) {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: settings, error: settingsErr } = await db
    .from("payment_settings")
    .select("*")
    .eq("account_id", accountId)
    .maybeSingle();
  if (settingsErr || !settings?.webhook_secret) {
    // No secret configured for this account — never accept unauthenticated calls.
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let secret: string;
  try {
    secret = decrypt(settings.webhook_secret);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const signature = request.headers.get(WEBHOOK_SIGNATURE_HEADER);
  const bearer = request.headers.get(WEBHOOK_SECRET_HEADER);
  if (!verifyWebhookSignature(secret, rawBody, signature, bearer)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  if (!parsed.reference) {
    return NextResponse.json({ error: "no order reference in payload" }, { status: 400 });
  }

  const { data: order, error: orderErr } = await db
    .from("product_orders")
    .select("id, status")
    .eq("account_id", accountId)
    .eq("payment_reference", parsed.reference)
    .maybeSingle();
  if (orderErr || !order) {
    return NextResponse.json({ error: "order not found" }, { status: 404 });
  }

  try {
    if (parsed.status === "cancelled" || parsed.status === "failed") {
      await setOrderStatus({
        orderId: order.id,
        status: parsed.status,
        provider: parsed.provider,
      });
      return NextResponse.json({ ok: true, order_id: order.id, status: parsed.status });
    }

    await setOrderStatus({
      orderId: order.id,
      status: "paid",
      provider: parsed.provider,
    });
    return NextResponse.json({ ok: true, order_id: order.id, status: "paid" });
  } catch (err) {
    console.error("[payments] webhook fulfillment failed:", err);
    return NextResponse.json({ error: "fulfillment failed" }, { status: 500 });
  }
}
