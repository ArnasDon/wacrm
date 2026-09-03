// ============================================================
// Decide se uma conta está bloqueada por causa da assinatura.
// Função pura — sem I/O, sem Supabase. Usada tanto pelo gate do
// layout (src/app/(dashboard)/layout.tsx) quanto pela defesa em
// profundidade em getCurrentAccount() (src/lib/auth/account.ts).
// ============================================================

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled";

export interface SubscriptionState {
  subscription_status: SubscriptionStatus;
  trial_ends_at: string | null;
}

export function isAccountBlocked(account: SubscriptionState): boolean {
  if (account.subscription_status === "past_due" || account.subscription_status === "canceled") {
    return true;
  }
  if (account.subscription_status === "trialing") {
    return account.trial_ends_at !== null && new Date(account.trial_ends_at) < new Date();
  }
  return false; // 'active'
}
