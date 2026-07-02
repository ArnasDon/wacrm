"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check, Globe } from "lucide-react";

import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/config";
import { setLocale } from "@/i18n/actions";
import { cn } from "@/lib/utils";

/**
 * Language picker — mirrors the mode/accent cards in AppearancePanel.
 * Persists to the `locale` cookie (read by every server render) and to
 * `profiles.locale` so the choice follows the user across devices.
 */
export function LocaleSwitcher() {
  const t = useTranslations("settings.language");
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handlePick = (next: Locale) => {
    if (next === locale) return;
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Globe className="size-4 text-muted-foreground" />
        {t("title")}
      </h3>

      <div
        role="radiogroup"
        aria-label={t("title")}
        className="grid max-w-md grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {LOCALES.map((code) => {
          const isActive = code === locale;
          return (
            <button
              key={code}
              type="button"
              role="radio"
              disabled={isPending}
              onClick={() => handlePick(code)}
              aria-checked={isActive}
              aria-label={LOCALE_LABELS[code]}
              className={cn(
                "flex items-center gap-3 rounded-lg border bg-card p-4 text-left transition-colors disabled:opacity-60",
                isActive
                  ? "border-primary/60 ring-2 ring-primary/40"
                  : "border-border hover:border-border hover:bg-muted/40",
              )}
            >
              <span className="flex-1 text-sm font-semibold text-foreground">
                {LOCALE_LABELS[code]}
              </span>
              {isActive && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                  <Check className="h-3 w-3" />
                  {t("active")}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
