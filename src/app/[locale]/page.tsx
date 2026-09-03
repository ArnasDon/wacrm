import { redirect } from "next/navigation";

// Localized root page.
//
// If a Supabase auth email lands here with `?code=...` (e.g. Site URL includes
// a locale prefix), forward it to the callback handler for the PKCE exchange.
// Otherwise redirect to the dashboard in the same locale.
export default async function LocaleRootPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const code = typeof sp.code === "string" ? sp.code : undefined;

  if (code) {
    const next = typeof sp.next === "string" ? sp.next : undefined;
    const qs = new URLSearchParams({ code });
    if (next) qs.set("next", next);
    redirect(`/auth/callback?${qs.toString()}`);
  }

  redirect(`/${locale}/dashboard`);
}
