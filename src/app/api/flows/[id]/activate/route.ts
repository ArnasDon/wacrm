import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { createClient } from "@/lib/supabase/server";
import { POST as publishFlowVersion } from "../versions/route";

/**
 * Compatibility status endpoint. `active` publishes the current draft;
 * draft/archive only prevent new runs and do not disturb pinned runs.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    await requireRole("agent");
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = (await request.json().catch(() => null)) as
    | {
        status?: "draft" | "active" | "archived";
        label?: string | null;
      }
    | null;
  const status = body?.status;
  if (!status || !["draft", "active", "archived"].includes(status)) {
    return NextResponse.json(
      { error: "status must be one of 'draft' | 'active' | 'archived'" },
      { status: 400 },
    );
  }

  if (status === "active") {
    return publishFlowVersion(
      new Request(request.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: body?.label ?? null }),
      }),
      { params: Promise.resolve({ id }) },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: existing } = await supabase
    .from("flows")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: updated, error } = await supabaseAdmin()
    .from("flows")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ flow: updated });
}
