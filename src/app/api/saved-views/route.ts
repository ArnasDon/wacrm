import { NextResponse } from "next/server";
import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import {
  SAVED_VIEW_RESOURCES,
  sanitizeContactsConfig,
  type SavedViewResource,
} from "@/lib/saved-views/types";

// Saved list views (migration 096). GET lists the views visible to the
// caller for a resource (own + account-shared); POST creates one owned
// by the caller. RLS-scoped read via the user client; service-role
// write after a role check so `user_id` / `account_id` can't be
// spoofed from the body.

const MAX_VIEWS_PER_USER_RESOURCE = 40;

function parseResource(v: string | null): SavedViewResource | null {
  return (SAVED_VIEW_RESOURCES as readonly string[]).includes(v ?? "")
    ? (v as SavedViewResource)
    : null;
}

export async function GET(request: Request) {
  try {
    const { supabase } = await getCurrentAccount();
    const resource = parseResource(new URL(request.url).searchParams.get("resource"));
    if (!resource) {
      return NextResponse.json({ error: "unknown resource" }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("saved_views")
      .select("*")
      .eq("resource", resource)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ saved_views: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireRole("viewer");
  } catch (err) {
    return toErrorResponse(err);
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const resource = parseResource(typeof body.resource === "string" ? body.resource : null);
  if (!resource) return NextResponse.json({ error: "unknown resource" }, { status: 400 });

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const db = supabaseAdmin();

  const { count } = await db
    .from("saved_views")
    .select("id", { count: "exact", head: true })
    .eq("account_id", ctx.accountId)
    .eq("user_id", ctx.userId)
    .eq("resource", resource);
  if ((count ?? 0) >= MAX_VIEWS_PER_USER_RESOURCE) {
    return NextResponse.json(
      { error: `You can save at most ${MAX_VIEWS_PER_USER_RESOURCE} views` },
      { status: 409 },
    );
  }

  const { data, error } = await db
    .from("saved_views")
    .insert({
      account_id: ctx.accountId,
      user_id: ctx.userId,
      resource,
      name,
      config: sanitizeContactsConfig(body.config),
      is_shared: body.is_shared === true,
      position: typeof body.position === "number" ? body.position : 0,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ saved_view: data }, { status: 201 });
}
