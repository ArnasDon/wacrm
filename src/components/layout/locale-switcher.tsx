"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Languages } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const LANGUAGE_OPTIONS = [
  { locale: "pt-BR", label: "Português (Brasil)" },
  { locale: "en", label: "English" },
] as const;

/**
 * Language switcher — sets the NEXT_LOCALE cookie (see
 * src/i18n/request.ts and /api/locale) and refreshes the current
 * route so every server component re-renders with the new dictionary.
 * Same icon-button footprint as ModeToggle, next to it in the header.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const t = useTranslations("LocaleSwitcher");
  const currentLocale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  async function handleSelect(locale: string) {
    if (locale === currentLocale) {
      setOpen(false);
      return;
    }
    try {
      const res = await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      if (!res.ok) throw new Error(await res.text());
      setOpen(false);
      startTransition(() => router.refresh());
    } catch (err) {
      console.error("[locale-switcher] failed to set locale:", err);
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label={t("switchLanguage")}
        title={t("switchLanguage")}
        disabled={pending}
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50",
          className,
        )}
      >
        <Languages className="h-5 w-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LANGUAGE_OPTIONS.map((opt) => (
          <DropdownMenuItem
            key={opt.locale}
            onClick={() => handleSelect(opt.locale)}
            className={cn(opt.locale === currentLocale && "font-medium text-foreground")}
          >
            {opt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
