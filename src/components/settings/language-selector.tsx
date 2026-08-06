"use client";

import { Check, Languages } from "lucide-react";
import { useLocale } from "next-intl";
import { useState } from "react";

import { cn } from "@/lib/utils";

const LOCALE_COOKIE = "wacrm_locale";
const ONE_YEAR = 60 * 60 * 24 * 365;

const OPTIONS = [
  { value: "en", label: "English", shortLabel: "EN" },
  { value: "ko", label: "한국어", shortLabel: "KO" },
  { value: "pt", label: "Português", shortLabel: "PT" },
] as const;

type LocaleValue = (typeof OPTIONS)[number]["value"];

const COPY: Record<LocaleValue, { title: string; description: string; active: string }> = {
  en: { title: "Language", description: "Choose the language used throughout the application.", active: "Active" },
  ko: { title: "언어", description: "애플리케이션 전체에서 사용할 언어를 선택하세요.", active: "사용 중" },
  pt: { title: "Idioma", description: "Escolha o idioma utilizado em toda a aplicação.", active: "Activo" },
};

function persistLocale(locale: LocaleValue) {
  // This is an intentional browser side effect triggered by a user action.
  // eslint-disable-next-line react-hooks/immutability
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax`;
}

export function LanguageSelector() {
  const currentLocale = useLocale() as LocaleValue;
  const [changing, setChanging] = useState<LocaleValue | null>(null);
  const copy = COPY[currentLocale] ?? COPY.en;

  const selectLocale = (locale: LocaleValue) => {
    if (locale === currentLocale || changing) return;
    setChanging(locale);
    persistLocale(locale);
    window.location.reload();
  };

  return (
    <div className="mt-8 space-y-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Languages className="size-4 text-muted-foreground" />
          {copy.title}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{copy.description}</p>
      </div>

      <div role="radiogroup" aria-label={copy.title} className="grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
        {OPTIONS.map((option) => {
          const active = option.value === currentLocale;
          const loading = changing === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={changing !== null}
              onClick={() => selectLocale(option.value)}
              className={cn(
                "flex items-center gap-3 rounded-lg border bg-card p-4 text-left transition-colors disabled:cursor-wait disabled:opacity-70",
                active ? "border-primary/60 ring-2 ring-primary/40" : "border-border hover:bg-muted/40",
              )}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
                {option.shortLabel}
              </span>
              <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">
                {loading ? "…" : option.label}
              </span>
              {active && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                  <Check className="h-3 w-3" />
                  {copy.active}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
