/**
 * Single source of truth for the color-theme catalog.
 *
 * The CSS variables themselves live in `src/app/globals.css` under
 * `html[data-theme="..."]` blocks — that file is the one we paste
 * theme tokens into. This module only carries the metadata the UI
 * (settings picker, no-flash boot script) needs.
 *
 * Adding a new theme is a two-step change:
 *   1. Append the new `html[data-theme="<id>"]` block in globals.css
 *      with every token from an existing theme (use violet as the
 *      shape reference).
 *   2. Add an entry below. The order here drives the picker grid.
 */

export const THEME_IDS = [
  "violet",
  "emerald",
  "cobalt",
  "amber",
  "rose",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME: ThemeId = "violet";

export const STORAGE_KEY = "wacrm.theme";

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  tagline: string;
  /**
   * Static swatch color for the picker chip. Hard-coded so the boot
   * script / picker cards don't need a getComputedStyle round trip
   * before the page settles. Must mirror `--primary` of the same
   * theme in globals.css.
   */
  swatch: string;
}

export const THEMES: ReadonlyArray<ThemeMeta> = [
  {
    id: "violet",
    name: "Violet",
    tagline: "The default — confident, slightly playful.",
    swatch: "oklch(0.526 0.247 293)",
  },
  {
    id: "emerald",
    name: "Emerald",
    tagline: "Growth-coded, nods at messaging without copying WhatsApp green.",
    swatch: "oklch(0.62 0.16 162)",
  },
  {
    id: "cobalt",
    name: "Cobalt",
    tagline: "Clean B2B-SaaS blue — calm and product-y.",
    swatch: "oklch(0.585 0.2 254)",
  },
  {
    id: "amber",
    name: "Amber",
    tagline: "Warm and friendly — feels good for SMB teams.",
    swatch: "oklch(0.745 0.16 65)",
  },
  {
    id: "rose",
    name: "Rose",
    tagline: "Bold and modern — D2C, creator-economy, lifestyle.",
    swatch: "oklch(0.645 0.22 16)",
  },
];

export function isThemeId(value: unknown): value is ThemeId {
  return (
    typeof value === "string" &&
    (THEME_IDS as ReadonlyArray<string>).includes(value)
  );
}

// ============================================================
// Light / dark mode and a free-form accent colour.
//
// The five presets above stay as one-click starting points; the
// accent below is whatever hex the merchant picks, applied as inline
// custom properties on <html> so it overrides the theme block. Both
// are per device (localStorage), like the theme itself.
// ============================================================

export const MODE_IDS = ["dark", "light"] as const;
export type ModeId = (typeof MODE_IDS)[number];
export const DEFAULT_MODE: ModeId = "dark";
export const MODE_STORAGE_KEY = "wacrm.mode";
export const ACCENT_STORAGE_KEY = "wacrm.accent";

export function isModeId(value: unknown): value is ModeId {
  return (
    typeof value === "string" && (MODE_IDS as ReadonlyArray<string>).includes(value)
  );
}

/** #rgb / #rrggbb, normalised to lowercase #rrggbb. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(hex)) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return /^#[0-9a-f]{6}$/.test(hex) ? hex : null;
}

/**
 * Black or white text on top of this colour, whichever stays
 * readable. sRGB relative luminance, the same rule WCAG contrast is
 * built on — a mid-yellow accent gets black text, a navy gets white.
 */
export function readableTextOn(hex: string): "#ffffff" | "#0f172a" {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  return luminance > 0.45 ? "#0f172a" : "#ffffff";
}

/**
 * The custom properties an accent colour maps to. Hover lightens the
 * colour, the two "soft" tints are the translucent washes used behind
 * active nav items and badges.
 */
export function accentVars(hex: string): Record<string, string> {
  return {
    "--primary": hex,
    "--primary-foreground": readableTextOn(hex),
    "--primary-hover": `color-mix(in srgb, ${hex} 82%, white)`,
    "--primary-soft": `color-mix(in srgb, ${hex} 14%, transparent)`,
    "--primary-soft-2": `color-mix(in srgb, ${hex} 24%, transparent)`,
    "--ring": hex,
    "--sidebar-primary": hex,
    "--chart-1": hex,
  };
}
