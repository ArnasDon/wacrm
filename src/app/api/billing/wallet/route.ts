import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const admin = supabaseAdmin();

    // 1. Fetch wallet
    const { data: wallet } = await supabase
      .from("account_wallets")
      .select("*")
      .eq("account_id", accountId)
      .maybeSingle();

    // 2. Fetch global billing settings
    const { data: settings } = await supabase
      .from("billing_settings")
      .select("default_per_message_rate, currency, credit_unit_value, recharge_mode")
      .eq("id", true)
      .maybeSingle();

    // 3. Fetch effective rate RPC
    const { data: rateData } = await admin.rpc("effective_rate", {
      p_account_id: accountId,
    });
    const effectiveRate = typeof rateData === "number" ? rateData : 1.50;

    // 4. Fetch recent transactions
    const { data: transactions } = await supabase
      .from("credit_transactions")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(50);

    return NextResponse.json({
      wallet: wallet ?? { balance: 0, low_balance_threshold: 0 },
      settings: settings ?? {
        default_per_message_rate: 1.50,
        currency: "INR",
        credit_unit_value: 1.00,
        recharge_mode: "manual",
      },
      effectiveRate,
      transactions: transactions ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
