import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requirePlatformAdmin } from "@/lib/auth/platform-admin";
import { toErrorResponse } from "@/lib/auth/account";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePlatformAdmin();
    const admin = supabaseAdmin();

    const { data: settings, error } = await admin
      .from("billing_settings")
      .select("*")
      .eq("id", true)
      .maybeSingle();

    if (error) {
      console.error("[admin-billing-settings] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to fetch billing settings" },
        { status: 500 }
      );
    }

    return NextResponse.json({ settings });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    await requirePlatformAdmin();
    const admin = supabaseAdmin();
    const body = await request.json();

    const {
      default_per_message_rate,
      currency,
      credit_unit_value,
      recharge_mode,
      gateway_provider,
    } = body;

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (typeof default_per_message_rate === "number") {
      updates.default_per_message_rate = default_per_message_rate;
    }
    if (typeof currency === "string") {
      updates.currency = currency;
    }
    if (typeof credit_unit_value === "number") {
      updates.credit_unit_value = credit_unit_value;
    }
    if (["manual", "gateway", "both"].includes(recharge_mode)) {
      updates.recharge_mode = recharge_mode;
    }
    if (typeof gateway_provider === "string") {
      updates.gateway_provider = gateway_provider;
    }

    const { data: updated, error } = await admin
      .from("billing_settings")
      .update(updates)
      .eq("id", true)
      .select()
      .single();

    if (error) {
      console.error("[admin-billing-settings] update error:", error);
      return NextResponse.json(
        { error: "Failed to update billing settings" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, settings: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
