// ============================================================
// /api/orders/[id]
//
//   PATCH — change payment state (admin+). The manual fallback to
//           the webhook: an admin can mark an order Paid (fulfils
//           it — confirmation + download link are WhatsApp'd) or
//           cancel it. Only `paid` / `cancelled` are accepted;
//           `pending` exists for future flows but has no effect.
//
// Admin+ because flipping payment state is a settings-class action;
// the manual path is what makes the product module work without a
// payment gateway at all.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { setOrderStatus } from "@/lib/products/fulfill";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("admin");
  } catch (err) {
    return toErrorResponse(err);
  }

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (body.status !== "paid" && body.status !== "cancelled") {
    return NextResponse.json({ error: "status must be paid or cancelled" }, { status: 400 });
  }

  try {
    const order = await setOrderStatus({
      orderId: id,
      status: body.status,
      provider: body.status === "paid" ? "manual" : null,
    });
    return NextResponse.json({
      order: {
        ...order,
        amount: Number(order.amount) || 0,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to update order";
    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
