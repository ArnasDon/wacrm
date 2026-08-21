import { NextResponse } from "next/server";
import { requirePlatformAdmin, toErrorResponse } from "@/lib/auth/account";
import { platformAdminClient } from "@/lib/platform/admin-client";

/**
 * GET /api/admin/tickets  (platform admin only)
 *
 * Lists every "Reportar un problema" ticket (migration 074), newest
 * first, for the /admin "Tickets de soporte" section. Uses the
 * service-role client — same pattern as GET /api/admin/companies —
 * so a single query can read across every account regardless of RLS.
 */
export async function GET() {
  try {
    await requirePlatformAdmin();
    const admin = platformAdminClient();

    const { data, error } = await admin
      .from("support_tickets")
      .select(
        "id, ticket_number, account_name, reporter_name, reporter_email, description, status, admin_note, created_at, resolved_at",
      )
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ tickets: data ?? [] });
  } catch (error) {
    return toErrorResponse(error);
  }
}
