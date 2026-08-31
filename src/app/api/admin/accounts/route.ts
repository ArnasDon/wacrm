import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requirePlatformAdmin } from "@/lib/auth/platform-admin";
import { toErrorResponse } from "@/lib/auth/account";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePlatformAdmin();
    const admin = supabaseAdmin();

    // 1. Fetch all accounts
    const { data: accounts, error: accountsErr } = await admin
      .from("accounts")
      .select("id, name, created_at, owner_user_id")
      .order("created_at", { ascending: false });

    if (accountsErr) {
      console.error("[admin-accounts] error fetching accounts:", accountsErr);
      return NextResponse.json(
        { error: "Failed to fetch accounts" },
        { status: 500 }
      );
    }

    const accountIds = (accounts ?? []).map((a) => a.id);
    if (accountIds.length === 0) {
      return NextResponse.json({ accounts: [] });
    }

    // 2. Fetch profiles to count members per account
    const { data: profiles } = await admin
      .from("profiles")
      .select("account_id")
      .in("account_id", accountIds);

    const memberCounts = new Map<string, number>();
    for (const p of profiles ?? []) {
      if (p.account_id) {
        memberCounts.set(p.account_id, (memberCounts.get(p.account_id) ?? 0) + 1);
      }
    }

    // 3. Fetch whatsapp_config status per account
    const { data: waConfigs } = await admin
      .from("whatsapp_config")
      .select("account_id, status")
      .in("account_id", accountIds);

    const waStatuses = new Map<string, string>();
    for (const w of waConfigs ?? []) {
      if (w.account_id) {
        waStatuses.set(w.account_id, w.status ?? "disconnected");
      }
    }

    // 4. Combine into final list
    const result = (accounts ?? []).map((acc) => ({
      id: acc.id,
      name: acc.name,
      owner_user_id: acc.owner_user_id,
      created_at: acc.created_at,
      member_count: memberCounts.get(acc.id) ?? 0,
      whatsapp_status: waStatuses.get(acc.id) ?? "disconnected",
    }));

    return NextResponse.json({ accounts: result });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    await requirePlatformAdmin();
    const admin = supabaseAdmin();
    const body = await request.json();

    const { name, business_admin_email, business_admin_password, full_name } = body;

    if (!name || !business_admin_email || !business_admin_password) {
      return NextResponse.json(
        { error: "Account name, admin email, and admin password are required." },
        { status: 400 }
      );
    }

    // 1. Create business-admin auth user (trigger auto-creates account & profile)
    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email: business_admin_email,
      password: business_admin_password,
      email_confirm: true,
      user_metadata: {
        full_name: full_name || name,
      },
    });

    if (userErr || !userData.user) {
      console.error("[admin-create-account] user creation error:", userErr);
      return NextResponse.json(
        { error: `Failed to create business admin user: ${userErr?.message}` },
        { status: 400 }
      );
    }

    const userId = userData.user.id;

    // 2. Fetch the newly created profile/account id
    const { data: profile } = await admin
      .from("profiles")
      .select("account_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (!profile?.account_id) {
      return NextResponse.json(
        { error: "Account created but profile failed to bind." },
        { status: 500 }
      );
    }

    // 3. Update account name & business_name
    await admin
      .from("accounts")
      .update({
        name: name,
        business_name: name,
      })
      .eq("id", profile.account_id);

    return NextResponse.json({
      success: true,
      account_id: profile.account_id,
      business_admin_id: userId,
      name,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
