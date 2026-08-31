import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requirePlatformAdmin } from "@/lib/auth/platform-admin";
import { toErrorResponse } from "@/lib/auth/account";
import { isAccountRole } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requirePlatformAdmin();
    const { id: accountId } = await params;
    const admin = supabaseAdmin();
    const body = await request.json();

    const { email, password, full_name, role } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "email and password are required" },
        { status: 400 }
      );
    }

    const accountRole = isAccountRole(role) ? role : "agent";

    // Create user with provision_account_id and provision_role metadata
    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: full_name || "",
        provision_account_id: accountId,
        provision_role: accountRole,
      },
    });

    if (userErr || !userData.user) {
      console.error("[admin-create-user] user creation error:", userErr);
      return NextResponse.json(
        { error: `Failed to create user: ${userErr?.message}` },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      user_id: userData.user.id,
      account_id: accountId,
      role: accountRole,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
