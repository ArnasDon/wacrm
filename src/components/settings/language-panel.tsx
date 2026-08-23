"use client";

import { useCallback, useSyncExternalStore, useTransition } from "react";
import { Check, Globe } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import {
  SUPPORTED_LOCALES,
  type Locale,
  persistLocale,
  readStoredLocale,
} from "@/lib/locales";
import { cn } from "@/lib/utils";

/**
 * Language picker.
 *
 * Three choices: automatic (follow the browser's Accept-Language) plus
 * one card per supported locale. Picking writes the cookie and calls
 * router.refresh(), which re-runs the server render — messages are
 * resolved server-side, so a refresh is what actually swaps the
 * strings. No save button, matching the rest of this panel.
 *
 * The stored pick is read through useSyncExternalStore rather than
 * during render: the cookie does not exist on the server, so reading
 * it in the render body would make the first client paint disagree
 * with the server HTML and trip a hydration mismatch. The server
 * snapshot is null ("automatic"), which is also the truthful default
 * for anyone who has never picked.
 */

/**
 * Subscribers to the locale cookie.
 *
 * The cookie only ever changes through `pick()` below, so there is no
 * browser event to listen to — this component is the store's only
 * writer, and it notifies itself.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** Server render has no cookie access — always "automatic". */
function serverSnapshot(): Locale | null {
  return null;
}
export function LanguagePanel() {
  const t = useTranslations("Settings.language");
  const activeLocale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const selected = useSyncExternalStore(
    subscribe,
    readStoredLocale,
    serverSnapshot,
  );

  const pick = useCallback(
    (locale: Locale | null) => {
      persistLocale(locale);
      listeners.forEach((notify) => notify());
      startTransition(() => router.refresh());
    },
    [router],
  );

  return (
    <div className="mt-8 space-y-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Globe className="size-4 text-muted-foreground" />
        {t("title")}
      </h3>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("description")}
      </p>

      <div
        role="radiogroup"
        aria-label={t("title")}
        aria-busy={isPending}
        className={cn(
          "grid max-w-md gap-3 sm:grid-cols-3",
          isPending && "opacity-70",
        )}
      >
        <LanguageCard
          label={t("automatic")}
          hint={t("automaticHint")}
          isActive={selected === null}
          onPick={() => pick(null)}
        />
        {SUPPORTED_LOCALES.map((locale) => (
          <LanguageCard
            key={locale.id}
            label={locale.label}
            // On auto-detect, mark the locale the browser actually
            // resolved to so the row never reads as "nothing selected".
            hint={
              selected === null && locale.id === activeLocale
                ? t("detected")
                : locale.id.toUpperCase()
            }
            isActive={selected === locale.id}
            onPick={() => pick(locale.id)}
          />
        ))}
      </div>
    </div>
  );
}

function LanguageCard({
  label,
  hint,
  isActive,
  onPick,
}: {
  label: string;
  hint: string;
  isActive: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={isActive}
      onClick={onPick}
      className={cn(
        "flex flex-col gap-1 rounded-lg border bg-card p-4 text-left transition-colors",
        isActive
          ? "border-primary/60 ring-2 ring-primary/40"
          : "border-border hover:border-border hover:bg-muted/40",
      )}
    >
      <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
        {label}
        {isActive && <Check className="h-3.5 w-3.5 text-primary" />}
      </span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </button>
  );
}
