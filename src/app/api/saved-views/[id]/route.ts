import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { sanitizeContactsConfig } from "@/lib/saved-views/types";

// PATCH / DELETE a single saved view. The write is scoped to
// `account_id` + `user_id` (the caller) so a member can only ever
// touch their own views — mirrors the RLS write policy in
// migration 096.

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: Ctx) {
  let ctx;
  try {
    ctx = await requireRole("viewer");
  } catch (err) {
    return toErrorResponse(err);
  }
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    const name = body.name.trim().slice(0, 60);
    if (!name) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    patch.name = name;
  }
  if (body.config !== undefined) patch.config = sanitizeContactsConfig(body.config);
  if (typeof body.is_shared === "boolean") patch.is_shared = body.is_shared;
  if (typeof body.position === "number") patch.position = body.position;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin()
    .from("saved_views")
    .update(patch)
    .eq("id", id)
    .eq("account_id", ctx.accountId)
    .eq("user_id", ctx.userId)
    .select("*")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ saved_view: data });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  let ctx;
  try {
    ctx = await requireRole("viewer");
  } catch (err) {
    return toErrorResponse(err);
  }
  const { id } = await params;

  const { error } = await supabaseAdmin()
    .from("saved_views")
    .delete()
    .eq("id", id)
    .eq("account_id", ctx.accountId)
    .eq("user_id", ctx.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
