import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";
import { canManageBilling } from "@/lib/auth/roles";
import { isAccountRole } from "@/lib/auth/roles";
import { BillingActions } from "./billing-actions";

export default async function BillingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_id, account_role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.account_id || !isAccountRole(profile.account_role)) {
    redirect("/dashboard");
  }

  const { data: account } = await supabase
    .from("accounts")
    .select("name, subscription_status, trial_ends_at")
    .eq("id", profile.account_id)
    .maybeSingle();
  if (!account) redirect("/dashboard");

  const t = await getTranslations("Billing");
  const canManage = canManageBilling(profile.account_role);

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground">{account.name}</p>
      </div>
      <div className="rounded-lg border p-4">
        <p className="font-medium">
          {t("statusLabel")}:{" "}
          {t(`status.${account.subscription_status}` as "status.active")}
        </p>
        {account.subscription_status === "trialing" && account.trial_ends_at ? (
          <p className="text-muted-foreground text-sm">
            {t("trialEndsAt", { date: new Date(account.trial_ends_at).toLocaleDateString() })}
          </p>
        ) : null}
      </div>
      {canManage ? (
        <BillingActions status={account.subscription_status} />
      ) : (
        <p className="text-muted-foreground text-sm">{t("ownerOnly")}</p>
      )}
    </div>
  );
}
