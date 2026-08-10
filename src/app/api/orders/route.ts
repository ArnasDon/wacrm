// ============================================================
// /api/orders
//
//   GET — list this account's product orders, newest first, with the
//         product row joined in (any member). The contact name is
//         fetched in a second query (contacts can be deleted — the
//         order row survives with `contact_id` NULL).
//
// The payment state changes go through /api/orders/[id] (admin+).
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import type { ProductOrder } from "@/types";

const MAX_ORDERS = 200;

function normalizeOrder(order: Record<string, unknown>) {
  return {
    ...order,
    amount: Number(order.amount) || 0,
  };
}

export async function GET() {
  let ctx: Awaited<ReturnType<typeof getCurrentAccount>>;
  try {
    ctx = await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  const { data, error } = await ctx.supabase
    .from("product_orders")
    .select("*, product:products(*)")
    .eq("account_id", ctx.accountId)
    .order("created_at", { ascending: false })
    .limit(MAX_ORDERS);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const orders = (data ?? []) as ProductOrder[];
  const contactIds = [...new Set(orders.map((o) => o.contact_id).filter(Boolean))];

  let contacts: Record<string, string | null> = {};
  if (contactIds.length > 0) {
    const { data: contactRows } = await ctx.supabase
      .from("contacts")
      .select("id, name")
      .in("id", contactIds);
    contacts = Object.fromEntries(
      (contactRows ?? []).map((c) => [c.id, c.name ?? null]),
    );
  }

  return NextResponse.json({
    orders: orders.map((order) => ({
      ...normalizeOrder(order as unknown as Record<string, unknown>),
      contact_name: order.contact_id ? contacts[order.contact_id] ?? null : null,
    })),
  });
}
