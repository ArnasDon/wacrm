"use client";

import { useState, useEffect } from "react";
import { Check } from "lucide-react";

import { useTheme } from "@/hooks/use-theme";
import { THEMES, type ThemeId } from "@/lib/themes";
import { cn } from "@/lib/utils";

/**
 * Appearance panel — color-theme picker.
 *
 * Click a card → applies + persists immediately. No save button:
 * the whole change is a single CSS-variable swap on <html>, there's
 * nothing to roll back. The active card carries a check chip + a
 * primary-tinted border so the current pick is obvious.
 *
 * Persistence: localStorage only (device-scoped). The boot script in
 * layout.tsx replays the choice before first paint on subsequent
 * loads.
 */
export function AppearancePanel() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">Tema de cor</h2>
        <p className="mt-1 text-sm text-slate-400">
          Escolha a cor de destaque usada no aplicativo. Todos os temas continuam escuros — apenas a cor principal (botões, navegação ativa, selos) muda. Salvo neste dispositivo.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {THEMES.map((t) => (
          <ThemeCard
            key={t.id}
            id={t.id}
            name={t.name}
            tagline={t.tagline}
            swatch={t.swatch}
            isActive={mounted && t.id === theme}
            onPick={() => setTheme(t.id)}
          />
        ))}
      </div>
    </section>
  );
}

function ThemeCard({
  id,
  name,
  tagline,
  swatch,
  isActive,
  onPick,
}: {
  id: ThemeId;
  name: string;
  tagline: string;
  swatch: string;
  isActive: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={isActive}
      aria-label={`Usar tema ${name}`}
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-4 text-left transition-colors",
        isActive
          ? "border-primary/60 ring-2 ring-primary/40"
          : "border-slate-800 hover:border-slate-700 hover:bg-slate-800/40",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          aria-hidden
          className="h-8 w-8 shrink-0 rounded-full"
          style={{
            background: swatch,
            boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 0.15)",
          }}
        />
        {isActive && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
            <Check className="h-3 w-3" />
            Ativo
          </span>
        )}
      </div>
      <div>
        <div className="text-sm font-semibold text-white">{name}</div>
        <div className="mt-1 text-xs leading-relaxed text-slate-400">
          {tagline}
        </div>
      </div>
      <div
        className="mt-1 flex h-2 overflow-hidden rounded-full"
        aria-hidden
      >
        <span className="flex-1" style={{ background: swatch }} />
        <span className="w-3 bg-slate-700" />
        <span className="w-3 bg-slate-800" />
        <span className="w-3 bg-slate-900" />
      </div>
      <span className="sr-only">ID do tema: {id}</span>
    </button>
  );
}
