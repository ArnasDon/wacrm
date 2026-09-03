import { redirect } from "next/navigation";
import { defaultLocale } from "@/i18n/config";

// Root page.
//
// Supabase auth emails whose "Site URL" is the bare domain land here as
// `/?code=...`. Forward those to the dedicated callback handler so the PKCE
// code gets exchanged for a session. Everything else goes to the dashboard.
export default async function RootPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const code = typeof params.code === "string" ? params.code : undefined;

  if (code) {
    const next = typeof params.next === "string" ? params.next : undefined;
    const qs = new URLSearchParams({ code });
    if (next) qs.set("next", next);
    redirect(`/auth/callback?${qs.toString()}`);
  }

  redirect(`/${defaultLocale}/dashboard`);
}
