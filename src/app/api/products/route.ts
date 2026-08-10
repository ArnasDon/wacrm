// ============================================================
// /api/products
//
//   GET  — list this account's products (any member).
//   POST — create a product (agent+). Enforced here AND by the
//          products_insert RLS policy (the row carries account_id).
//
// Prices are NUMERIC(12,2) — PostgREST returns them as strings, so
// responses are normalised to numbers for the typed UI.
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import type { ProductKind } from "@/types";

function normalizeProduct(row: Record<string, unknown>) {
  return {
    ...row,
    price: Number(row.price) || 0,
    file_size_bytes: row.file_size_bytes != null ? Number(row.file_size_bytes) : null,
  };
}

export async function GET() {
  try {
    await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  const ctx = await getCurrentAccount();
  const { data, error } = await ctx.supabase
    .from("products")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ products: (data ?? []).map(normalizeProduct) });
}

export async function POST(request: Request) {
  try {
    await requireRole("agent");
  } catch (err) {
    return toErrorResponse(err);
  }

  const ctx = await getCurrentAccount();
  const { userId, accountId } = ctx;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (name.length > 120) {
    return NextResponse.json({ error: "name is too long" }, { status: 400 });
  }

  const price = Number(body.price ?? 0);
  if (!Number.isFinite(price) || price < 0) {
    return NextResponse.json({ error: "price must be a non-negative number" }, { status: 400 });
  }

  const kind: ProductKind = body.kind === "physical" ? "physical" : "digital";

  const currency = typeof body.currency === "string" && body.currency.trim() ? body.currency.trim().toUpperCase() : "USD";
  if (!/^[A-Z]{3}$/.test(currency)) {
    return NextResponse.json({ error: "currency must be a 3-letter ISO code" }, { status: 400 });
  }

  const paymentLink =
    typeof body.payment_link === "string" && body.payment_link.trim()
      ? body.payment_link.trim()
      : null;
  if (paymentLink && !/^https?:\/\//i.test(paymentLink)) {
    return NextResponse.json({ error: "payment link must be a valid http(s) URL" }, { status: 400 });
  }

  const file = (body.file ?? null) as
    | { path?: unknown; name?: unknown; size_bytes?: unknown; mime_type?: unknown }
    | null;

  const { data, error } = await ctx.supabase
    .from("products")
    .insert({
      account_id: accountId,
      user_id: userId,
      name,
      description:
        typeof body.description === "string" && body.description.trim() ? body.description.trim() : null,
      price,
      currency,
      kind,
      is_active: body.is_active !== false,
      payment_link: paymentLink,
      file_path: file?.path ? String(file.path) : null,
      file_name: file?.name ? String(file.name) : null,
      file_size_bytes: file?.size_bytes != null ? Number(file.size_bytes) : null,
      file_mime_type: file?.mime_type ? String(file.mime_type) : null,
    })
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ product: normalizeProduct(data as Record<string, unknown>) }, { status: 201 });
}
