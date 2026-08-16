import { NextResponse } from "next/server";
import { requirePlatformAdmin, toErrorResponse } from "@/lib/auth/account";
import { platformAdminClient } from "@/lib/platform/admin-client";
import { markAccountPaid } from "@/lib/admin/subscriptions";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requirePlatformAdmin();
    const { id } = await params;
    const body = (await request.json()) as {
      suspended?: unknown;
      reason?: unknown;
      mark_paid?: unknown;
      next_payment_due_at?: unknown;
    };

    if (body.mark_paid === true) {
      const result = await markAccountPaid(platformAdminClient(), id);
      return NextResponse.json({ company: result });
    }

    if ("next_payment_due_at" in body) {
      const value = body.next_payment_due_at;
      if (value !== null && typeof value !== "string") {
        return NextResponse.json({ error: "Fecha de pago inválida" }, { status: 400 });
      }
      const { data, error } = await platformAdminClient()
        .from("accounts")
        .update({ next_payment_due_at: value })
        .eq("id", id)
        .select("id, next_payment_due_at")
        .maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
      return NextResponse.json({ company: data });
    }

    if (typeof body.suspended !== "boolean") {
      return NextResponse.json({ error: "El estado de suspensión es obligatorio" }, { status: 400 });
    }

    if (id === ctx.accountId && body.suspended) {
      return NextResponse.json({ error: "No puedes suspender la empresa desde la que administras la plataforma" }, { status: 409 });
    }

    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    const { data, error } = await platformAdminClient()
      .from("accounts")
      .update({
        suspended_at: body.suspended ? new Date().toISOString() : null,
        suspended_reason: body.suspended ? reason || "Suscripción pausada" : null,
      })
      .eq("id", id)
      .select("id, suspended_at, suspended_reason")
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
    return NextResponse.json({ company: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
