import { NextResponse } from "next/server";
import { requirePlatformAdmin, toErrorResponse } from "@/lib/auth/account";
import { platformAdminClient } from "@/lib/platform/admin-client";

const MAX_NOTE_LENGTH = 2000;

/**
 * PATCH /api/admin/tickets/[id]  (platform admin only)
 *
 * Body: { status?: "open" | "resolved", admin_note?: string | null }.
 * At least one of the two must be present. `status` flips the ticket
 * from the /admin ticket log — sets resolved_at/resolved_by when
 * marking resolved, clears both when reopening. `admin_note` is a
 * freeform note Angel can leave for the reporting company, shown to
 * them in Settings → Tickets — settable independently of `status` so
 * he can jot progress without necessarily resolving/reopening.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requirePlatformAdmin();
    const { id } = await params;
    const body = (await request.json()) as { status?: unknown; admin_note?: unknown };

    const hasStatus = body.status !== undefined;
    const hasNote = body.admin_note !== undefined;

    if (!hasStatus && !hasNote) {
      return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
    }
    if (hasStatus && body.status !== "open" && body.status !== "resolved") {
      return NextResponse.json({ error: "status debe ser 'open' o 'resolved'" }, { status: 400 });
    }
    if (hasNote && body.admin_note !== null && typeof body.admin_note !== "string") {
      return NextResponse.json({ error: "admin_note debe ser texto o null" }, { status: 400 });
    }
    if (hasNote && typeof body.admin_note === "string" && body.admin_note.length > MAX_NOTE_LENGTH) {
      return NextResponse.json({ error: `admin_note no puede superar ${MAX_NOTE_LENGTH} caracteres` }, { status: 400 });
    }

    const update: Record<string, unknown> = {};
    if (hasStatus) {
      update.status = body.status;
      update.resolved_at = body.status === "resolved" ? new Date().toISOString() : null;
      update.resolved_by = body.status === "resolved" ? ctx.userId : null;
    }
    if (hasNote) {
      update.admin_note = typeof body.admin_note === "string" ? body.admin_note.trim() || null : null;
    }

    const admin = platformAdminClient();
    const { data, error } = await admin
      .from("support_tickets")
      .update(update)
      .eq("id", id)
      .select("id, status, resolved_at, admin_note")
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });

    return NextResponse.json({ ticket: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
