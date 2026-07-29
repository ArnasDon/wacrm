"use client";

import { Languages } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const LOCALES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
] as const;

export function LanguageSwitcher({ className }: { className?: string }) {
  const t = useTranslations("LanguageSwitcher");
  const { profile, updateLocale } = useAuth();
  const current = profile?.locale ?? "en";

  const handleChange = (code: string) => {
    if (code === current) return;
    updateLocale(code);
    window.location.reload();
  };

  return (
    <div className={cn("relative", className)}>
      <select
        value={current}
        onChange={(e) => handleChange(e.target.value)}
        aria-label={t("selectLanguage")}
        className="flex h-9 appearance-none items-center gap-2 rounded-md border border-border bg-transparent px-2 pr-7 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 [&>option]:bg-popover [&>option]:text-popover-foreground"
      >
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
      <Languages className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
