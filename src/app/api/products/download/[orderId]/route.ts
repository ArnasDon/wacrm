// ============================================================
// /api/products/download/[orderId]
//
// The link WhatsApp sends to a buyer after payment. It's a
// capability URL: the order id is an unguessable UUID and the route
// only serves orders in the `paid` state, so holding the link IS the
// authorisation (same model as invoice download links everywhere).
//
// On each visit it mints a FRESH short-lived signed storage URL for
// the product file and 302s to it — so the WhatsApp message stays
// valid for as long as the buyer needs it, rather than expiring ten
// minutes after payment.
//
// Public by design — the buyer is not a dashboard user. There is no
// session check; the paid-state + UUID check is the gate.
// ============================================================

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { createSignedDownloadUrl } from "@/lib/products/fulfill";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;

  const db = supabaseAdmin();
  const { data: order, error } = await db
    .from("product_orders")
    .select("*, product:products(*)")
    .eq("id", orderId)
    .maybeSingle();

  // Same 404 for "unknown order" and "not paid yet" — don't leak order
  // existence to someone probing with random UUIDs.
  if (error || !order || order.status !== "paid") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const product = order.product;
  if (!product?.file_path) {
    return NextResponse.json({ error: "no downloadable file" }, { status: 404 });
  }

  try {
    const signedUrl = await createSignedDownloadUrl(product.file_path);
    return NextResponse.redirect(signedUrl, 302);
  } catch (err) {
    console.error("[products] download route failed:", orderId, err);
    return NextResponse.json({ error: "download temporarily unavailable" }, { status: 500 });
  }
}
