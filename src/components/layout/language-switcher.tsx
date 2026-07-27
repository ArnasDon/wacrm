"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { locales, localeNames, type Locale } from "@/i18n/config";
import { Globe } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function LanguageSwitcher() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const handleLanguageChange = (newLocale: Locale) => {
    // Strip any leading locale prefix from usePathname() defensively —
    // createNavigation's usePathname should already strip it, but if it
    // doesn't, passing a locale-prefixed path to router.replace with a
    // locale option would produce a double prefix (e.g. /kk/kk/dashboard).
    const raw = pathname;
    const stripped = locales.some(
      (loc) => raw === `/${loc}` || raw.startsWith(`/${loc}/`),
    )
      ? raw.replace(/^\/[a-z]{2}/, "") || "/"
      : raw;
    router.replace(stripped, { locale: newLocale });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none"
        aria-label={t("common.open")}
      >
        <Globe className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6}>
        {locales.map((loc) => (
          <DropdownMenuItem
            key={loc}
            onClick={() => handleLanguageChange(loc)}
            className={loc === locale ? "bg-accent text-accent-foreground" : ""}
          >
            {localeNames[loc]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
