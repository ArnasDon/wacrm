// ============================================================
// /api/products/[id]
//
//   GET    — one product (any member).
//   PATCH  — edit a product (agent+).
//   DELETE — delete a product (agent+) + best-effort file cleanup.
//
// All lookups are scoped to the caller's account (RLS + explicit
// `.eq("account_id", …)` for belt-and-suspenders on the RLS client).
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { PRODUCT_FILE_BUCKET } from "@/lib/products/fulfill";
import type { ProductKind } from "@/types";

function normalizeProduct(row: Record<string, unknown>) {
  return {
    ...row,
    price: Number(row.price) || 0,
    file_size_bytes: row.file_size_bytes != null ? Number(row.file_size_bytes) : null,
  };
}

function parseBody(body: unknown): { error: string } | { value: Record<string, unknown> } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "invalid body" };
  }
  return { value: body as Record<string, unknown> };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  const account = await getCurrentAccount();
  const { id } = await params;
  const { data, error } = await account.supabase
    .from("products")
    .select("*")
    .eq("account_id", account.accountId)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ product: normalizeProduct(data as Record<string, unknown>) });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("agent");
  } catch (err) {
    return toErrorResponse(err);
  }

  const account = await getCurrentAccount();
  const { id } = await params;
  const parsed = parseBody(await request.json().catch(() => null));
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const body = parsed.value;

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    if (name.length > 120) return NextResponse.json({ error: "name is too long" }, { status: 400 });
    updates.name = name;
  }
  if ("description" in body) {
    updates.description =
      typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
  }
  if ("price" in body) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: "price must be a non-negative number" }, { status: 400 });
    }
    updates.price = price;
  }
  if ("currency" in body) {
    const currency = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "";
    if (!/^[A-Z]{3}$/.test(currency)) {
      return NextResponse.json({ error: "currency must be a 3-letter ISO code" }, { status: 400 });
    }
    updates.currency = currency;
  }
  if ("kind" in body) {
    if (body.kind !== "digital" && body.kind !== "physical") {
      return NextResponse.json({ error: "kind must be digital or physical" }, { status: 400 });
    }
    updates.kind = body.kind as ProductKind;
  }
  if ("is_active" in body) {
    updates.is_active = Boolean(body.is_active);
  }
  if ("payment_link" in body) {
    const link = typeof body.payment_link === "string" && body.payment_link.trim() ? body.payment_link.trim() : null;
    if (link && !/^https?:\/\//i.test(link)) {
      return NextResponse.json({ error: "payment link must be a valid http(s) URL" }, { status: 400 });
    }
    updates.payment_link = link;
  }
  if ("file" in body) {
    const file = body.file as
      | { path?: unknown; name?: unknown; size_bytes?: unknown; mime_type?: unknown }
      | null
      | undefined;
    if (file && typeof file === "object") {
      updates.file_path = file.path ? String(file.path) : null;
      updates.file_name = file.name ? String(file.name) : null;
      updates.file_size_bytes = file.size_bytes != null ? Number(file.size_bytes) : null;
      updates.file_mime_type = file.mime_type ? String(file.mime_type) : null;
    } else {
      // Explicit `file: null` clears the attached file.
      updates.file_path = null;
      updates.file_name = null;
      updates.file_size_bytes = null;
      updates.file_mime_type = null;
    }
  }

  // If the file was replaced/cleared, drop the old object afterwards.
  const { data: existing } = await account.supabase
    .from("products")
    .select("file_path")
    .eq("account_id", account.accountId)
    .eq("id", id)
    .maybeSingle();

  const { data, error } = await account.supabase
    .from("products")
    .update(updates)
    .eq("account_id", account.accountId)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (existing?.file_path && existing.file_path !== updates.file_path) {
    void account.supabase.storage.from(PRODUCT_FILE_BUCKET).remove([existing.file_path]).catch(() => {});
  }

  return NextResponse.json({ product: normalizeProduct(data as Record<string, unknown>) });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("agent");
  } catch (err) {
    return toErrorResponse(err);
  }

  const account = await getCurrentAccount();
  const { id } = await params;

  const { data: existing } = await account.supabase
    .from("products")
    .select("file_path")
    .eq("account_id", account.accountId)
    .eq("id", id)
    .maybeSingle();

  const { error } = await account.supabase
    .from("products")
    .delete()
    .eq("account_id", account.accountId)
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (existing?.file_path) {
    void account.supabase.storage.from(PRODUCT_FILE_BUCKET).remove([existing.file_path]).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
