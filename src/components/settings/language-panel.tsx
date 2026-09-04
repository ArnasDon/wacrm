"use client";

import { Check, Languages } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { SettingsPanelHead } from "./settings-panel-head";

const LOCALES = [
  { code: "en", label: "English", native: "English" },
  { code: "es", label: "Spanish", native: "Español" },
] as const;

export function LanguagePanel() {
  const t = useTranslations("Settings.language");
  const { profile, updateLocale } = useAuth();
  const current = profile?.locale ?? "en";

  const handleChange = (code: string) => {
    if (code === current) return;
    updateLocale(code);
  };

  return (
    <section className="max-w-3xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title={t("title")}
        description={t("description")}
      />

      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Languages className="size-4 text-muted-foreground" />
          {t("language")}
        </h3>

        <div
          role="radiogroup"
          aria-label="UI language"
          className="grid max-w-md grid-cols-1 gap-2 sm:grid-cols-2"
        >
          {LOCALES.map((l) => {
            const isActive = l.code === current;
            return (
              <button
                key={l.code}
                type="button"
                role="radio"
                onClick={() => handleChange(l.code)}
                aria-checked={isActive}
                className={cn(
                  "flex items-center gap-3 rounded-lg border bg-card p-4 text-left transition-colors",
                  isActive
                    ? "border-primary/60 ring-2 ring-primary/40"
                    : "border-border hover:border-border hover:bg-muted/40",
                )}
              >
                <span className="flex-1">
                  <span className="text-sm font-semibold text-foreground">
                    {l.native}
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {l.label}
                  </span>
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

        <p className="text-xs text-muted-foreground">
          {t("reloadHint")}
        </p>
      </div>
    </section>
  );
}
