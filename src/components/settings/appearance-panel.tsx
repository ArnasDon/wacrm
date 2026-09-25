"use client";

import { useState } from "react";
import { Check, Moon, Sun } from "lucide-react";

import { useTheme } from "@/hooks/use-theme";
import { MODE_IDS, THEMES, normalizeHex, type ModeId, type ThemeId } from "@/lib/themes";
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
const MODE_COPY: Record<ModeId, { label: string; hint: string; Icon: typeof Sun }> = {
  dark: { label: "Dark", hint: "Easier at night and on cheap screens.", Icon: Moon },
  light: { label: "Light", hint: "Better in daylight and for printing screenshots.", Icon: Sun },
};

export function AppearancePanel() {
  const { theme, setTheme, mode, setMode, accent, setAccent } = useTheme();
  const [draft, setDraft] = useState(accent ?? "#7c3aed");

  const applyDraft = (value: string) => {
    setDraft(value);
    if (normalizeHex(value)) setAccent(value);
  };

  return (
    <section className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-white">Light or dark</h2>
        <p className="mt-1 text-sm text-slate-400">
          Applies to every screen. Saved to this device, so your phone and your laptop can differ.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {MODE_IDS.map((id) => {
            const { label, hint, Icon } = MODE_COPY[id];
            const isActive = mode === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                aria-pressed={isActive}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-4 text-left transition-colors",
                  isActive
                    ? "border-primary/60 ring-2 ring-primary/40"
                    : "border-slate-800 hover:border-slate-700 hover:bg-slate-800/40",
                )}
              >
                <Icon className="mt-0.5 size-5 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-white">{label}</span>
                  <span className="mt-1 block text-xs text-slate-400">{hint}</span>
                </span>
                {isActive && <Check className="ml-auto size-4 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-white">Your own color</h2>
        <p className="mt-1 text-sm text-slate-400">
          Match your brand. Buttons, active menu items, badges and charts follow it; text stays readable
          because the label color is chosen from the color you pick.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            type="color"
            aria-label="Pick a brand color"
            value={normalizeHex(draft) ?? "#7c3aed"}
            onChange={(e) => applyDraft(e.target.value)}
            className="size-11 cursor-pointer rounded-lg border border-slate-700 bg-transparent p-1"
          />
          <input
            type="text"
            aria-label="Brand color hex code"
            value={draft}
            spellCheck={false}
            maxLength={7}
            onChange={(e) => applyDraft(e.target.value)}
            className="h-11 w-32 rounded-lg border border-slate-700 bg-slate-900 px-3 font-mono text-sm text-white outline-none focus:border-primary"
          />
          <span className="inline-flex h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
            Sample button
          </span>
          {accent && (
            <button
              type="button"
              onClick={() => setAccent(null)}
              className="text-xs text-slate-400 underline hover:text-white"
            >
              Back to a preset
            </button>
          )}
        </div>
        {!normalizeHex(draft) && (
          <p className="mt-2 text-xs text-amber-300">Use a hex code like #7c3aed.</p>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-white">Presets</h2>
        <p className="mt-1 text-sm text-slate-400">
          Ready-made accents. Picking one replaces a custom color.
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
            isActive={!accent && t.id === theme}
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
      aria-label={`Use ${name} theme`}
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
            Active
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
      <span className="sr-only">Theme id: {id}</span>
    </button>
  );
}
