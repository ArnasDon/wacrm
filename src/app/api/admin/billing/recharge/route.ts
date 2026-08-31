import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth/platform-admin";
import { toErrorResponse } from "@/lib/auth/account";
import { creditWallet } from "@/lib/billing/charge";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { userId } = await requirePlatformAdmin();

    const body = await request.json();
    const { account_id, credits, note } = body;

    if (!account_id || typeof credits !== "number" || credits <= 0) {
      return NextResponse.json(
        { error: "Invalid request. account_id and positive credits required." },
        { status: 400 }
      );
    }

    const newBalance = await creditWallet(
      account_id,
      credits,
      "recharge",
      "admin",
      "manual-topup",
      note || "Manual admin recharge",
      userId
    );

    return NextResponse.json({
      success: true,
      account_id,
      credits_added: credits,
      new_balance: newBalance,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
