import { supabaseAdmin } from "@/lib/automations/admin-client";

export type ChargeResult = "ok" | "insufficient";

/**
 * Pre-check if an account wallet has enough balance for at least one message.
 */
export async function hasCreditsForOne(accountId: string): Promise<boolean> {
  const admin = supabaseAdmin();
  try {
    const { data: wallet } = await admin
      .from("account_wallets")
      .select("balance")
      .eq("account_id", accountId)
      .maybeSingle();

    if (!wallet) return true; // Default allow if wallet hasn't been created yet

    const { data: rate } = await admin.rpc("effective_rate", {
      p_account_id: accountId,
    });

    const perMessageRate = typeof rate === "number" ? rate : 1.50;
    return (wallet.balance ?? 0) >= perMessageRate;
  } catch (err) {
    console.error("[billing] error checking credits:", err);
    return true; // Fallback allow on system check error
  }
}

/**
 * Atomic debit of one billable template message using debit_message RPC.
 */
export async function chargeBillableMessage(
  accountId: string,
  referenceType: string,
  referenceId: string
): Promise<ChargeResult> {
  const admin = supabaseAdmin();
  try {
    const { data, error } = await admin.rpc("debit_message", {
      p_account_id: accountId,
      p_reference_type: referenceType,
      p_reference_id: referenceId,
    });

    if (error) {
      console.error("[billing] debit_message RPC error:", error);
      return "insufficient";
    }

    return data === true ? "ok" : "insufficient";
  } catch (err) {
    console.error("[billing] chargeBillableMessage error:", err);
    return "insufficient";
  }
}

/**
 * Credit an account wallet (recharge / top-up).
 */
export async function creditWallet(
  accountId: string,
  credits: number,
  type: "recharge" | "adjustment" | "refund",
  referenceType: string,
  referenceId: string,
  note?: string,
  createdBy?: string
): Promise<number> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.rpc("credit_wallet", {
    p_account_id: accountId,
    p_credits: credits,
    p_type: type,
    p_reference_type: referenceType,
    p_reference_id: referenceId,
    p_note: note ?? null,
    p_created_by: createdBy ?? null,
  });

  if (error) {
    console.error("[billing] credit_wallet RPC error:", error);
    throw new Error(`Failed to credit wallet: ${error.message}`);
  }

  return Number(data);
}
