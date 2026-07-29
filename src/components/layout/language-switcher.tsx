"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { LOCALE_COOKIE, otherLocale, type Locale } from "@/lib/i18n/locales";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Language toggle — single button, same one-click UX as ModeToggle.
 * Shows the locale you'll switch *to*. Persists the choice in a cookie
 * (read server-side by src/i18n/request.ts) so it survives reloads and
 * applies before the next server render — no account/auth needed since
 * this must also work on the logged-out login/signup pages.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const t = useTranslations("LanguageSwitcher");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const next = otherLocale(locale);

  function handleClick() {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
    router.refresh();
  }

  const label = t("switchTo", { locale: next.toUpperCase() });

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-md text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {next.toUpperCase()}
    </button>
  );
}
