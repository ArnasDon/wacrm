import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requirePlatformAdmin } from "@/lib/auth/platform-admin";
import { toErrorResponse } from "@/lib/auth/account";
import { encrypt } from "@/lib/whatsapp/encryption";

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

    const {
      phone_number_id,
      waba_id,
      access_token,
      verify_token,
      display_phone_number,
      status,
    } = body;

    if (!phone_number_id || !access_token) {
      return NextResponse.json(
        { error: "phone_number_id and access_token are required" },
        { status: 400 }
      );
    }

    const encryptedToken = encrypt(access_token);

    // Upsert into whatsapp_config for account_id
    const { data: config, error } = await admin
      .from("whatsapp_config")
      .upsert(
        {
          account_id: accountId,
          phone_number_id: phone_number_id.trim(),
          waba_id: waba_id?.trim() || null,
          access_token: encryptedToken,
          verify_token: verify_token?.trim() || null,
          display_phone_number: display_phone_number?.trim() || null,
          status: status || "connected",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "account_id" }
      )
      .select("id, account_id, phone_number_id, status")
      .single();

    if (error) {
      console.error("[admin-whatsapp-config] upsert error:", error);
      return NextResponse.json(
        { error: `Failed to update WhatsApp config: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      config,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
