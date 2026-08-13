"use client";

import * as React from "react";
import { useLocale } from "next-intl";
import { Globe, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const languages = [
  { code: "pt-BR", label: "Português (Brasil)", flag: "🇧🇷", short: "PT-BR" },
  { code: "en", label: "English", flag: "🇺🇸", short: "EN" },
  { code: "pt", label: "Português (Portugal)", flag: "🇵🇹", short: "PT" },
  { code: "ko", label: "한국어", flag: "🇰🇷", short: "KO" },
];

export function LanguageToggle() {
  const currentLocale = useLocale();

  const currentLang =
    languages.find((l) => l.code === currentLocale) ?? languages[0];

  const handleSelectLanguage = (code: string) => {
    if (code === currentLocale) return;

    // Set cookie for next-intl server-side resolution
    document.cookie = `NEXT_LOCALE=${code}; path=/; max-age=31536000; SameSite=Lax`;
    document.cookie = `locale=${code}; path=/; max-age=31536000; SameSite=Lax`;

    // Refresh page to load new locale messages
    window.location.reload();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus:outline-none cursor-pointer"
        aria-label="Escolher Idioma / Select Language"
        title="Idioma do sistema"
      >
        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-base leading-none">{currentLang.flag}</span>
        <span className="hidden uppercase font-semibold sm:inline">{currentLang.short}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-48 bg-popover text-popover-foreground">
        {languages.map((lang) => {
          const isSelected = lang.code === currentLocale;
          return (
            <DropdownMenuItem
              key={lang.code}
              onClick={() => handleSelectLanguage(lang.code)}
              className="flex items-center justify-between cursor-pointer text-xs"
            >
              <span className="flex items-center gap-2">
                <span className="text-base leading-none">{lang.flag}</span>
                <span>{lang.label}</span>
              </span>
              {isSelected ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
