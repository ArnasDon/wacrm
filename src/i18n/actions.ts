"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { LOCALE_COOKIE, isLocale, type Locale } from "./config";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Sets the locale cookie that `src/i18n/request.ts` reads on every
 * render, and persists it to the signed-in user's profile so it
 * follows them across devices/sessions. Called from the language
 * switcher (settings) and once from `useAuth` to sync a stale cookie
 * with `profiles.locale` right after login.
 */
export async function setLocale(locale: Locale): Promise<void> {
  if (!isLocale(locale)) return;

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    maxAge: ONE_YEAR_SECONDS,
    path: "/",
    sameSite: "lax",
  });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await supabase.from("profiles").update({ locale }).eq("user_id", user.id);
  }
}
