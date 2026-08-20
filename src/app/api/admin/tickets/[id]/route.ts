import { NextResponse } from "next/server";
import { requirePlatformAdmin, toErrorResponse } from "@/lib/auth/account";
import { platformAdminClient } from "@/lib/platform/admin-client";

/**
 * PATCH /api/admin/tickets/[id]  (platform admin only)
 *
 * Body: { status: "open" | "resolved" }. Flips a ticket's status from
 * the /admin ticket log — sets resolved_at/resolved_by when marking
 * resolved, clears both when reopening.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requirePlatformAdmin();
    const { id } = await params;
    const body = (await request.json()) as { status?: unknown };

    if (body.status !== "open" && body.status !== "resolved") {
      return NextResponse.json({ error: "status debe ser 'open' o 'resolved'" }, { status: 400 });
    }

    const admin = platformAdminClient();
    const { data, error } = await admin
      .from("support_tickets")
      .update({
        status: body.status,
        resolved_at: body.status === "resolved" ? new Date().toISOString() : null,
        resolved_by: body.status === "resolved" ? ctx.userId : null,
      })
      .eq("id", id)
      .select("id, status, resolved_at")
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });

    return NextResponse.json({ ticket: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
