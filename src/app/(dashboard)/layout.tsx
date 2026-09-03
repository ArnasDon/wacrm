import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { isAccountBlocked } from "@/lib/billing/access";
import { DashboardShell } from "./dashboard-shell";

// Server layout whose only job is to declare "do not index" metadata
// for the authed app. robots.ts already disallows these paths at the
// crawler-level and middleware redirects unauthenticated visitors, so
// this is belt-and-suspenders — but SEO-critical if a URL ever leaks
// via a link shared externally.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

async function shouldRedirectToBilling(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;

    const { data: profile } = await supabase
      .from("profiles")
      .select("account_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!profile?.account_id) return false;

    const { data: account } = await supabase
      .from("accounts")
      .select("subscription_status, trial_ends_at")
      .eq("id", profile.account_id)
      .maybeSingle();
    if (!account) return false;

    return isAccountBlocked({
      subscription_status: account.subscription_status,
      trial_ends_at: account.trial_ends_at,
    });
  } catch {
    // Qualquer erro aqui: não bloqueia. O fluxo existente
    // (AccountAccessAlert) já cobre "algo deu errado ao carregar a
    // conta" — este gate só age quando tem certeza do bloqueio.
    return false;
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (await shouldRedirectToBilling()) {
    redirect("/billing");
  }
  return <DashboardShell>{children}</DashboardShell>;
}
