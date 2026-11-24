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
  "sunbeam",
  "violet",
  "emerald",
  "cobalt",
  "amber",
  "rose",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME: ThemeId = "sunbeam";

export const STORAGE_KEY = "wacrm.theme";

/**
 * MODE — the light/dark dimension, orthogonal to the accent theme.
 *
 * The CSS variables live in `src/app/globals.css` under
 * `html[data-mode="..."]` blocks (neutral surfaces only). Applied
 * at runtime via `document.documentElement.dataset.mode`. Light
 * ("Cream") is the default since the redesign; dark ("Espresso") is
 * the opt-in alternative.
 *
 * Persisted under its own localStorage key so it composes freely
 * with the accent choice (you can run Violet-light or Violet-dark).
 */
export const MODES = ["light", "dark"] as const;

export type Mode = (typeof MODES)[number];

export const DEFAULT_MODE: Mode = "light";

export const MODE_STORAGE_KEY = "wacrm.mode";

export const UI_STYLES = ["modern", "classic"] as const;

export type UiStyle = (typeof UI_STYLES)[number];

export const DEFAULT_UI_STYLE: UiStyle = "modern";

export const UI_STYLE_STORAGE_KEY = "wacrm.ui";

export const UI_STYLE_PRESETS: Record<UiStyle, { theme: ThemeId; mode: Mode }> = {
  modern: { theme: "sunbeam", mode: "light" },
  classic: { theme: "violet", mode: "dark" },
};

export function isUiStyle(value: unknown): value is UiStyle {
  return (
    typeof value === "string" &&
    (UI_STYLES as ReadonlyArray<string>).includes(value)
  );
}

export function isMode(value: unknown): value is Mode {
  return (
    typeof value === "string" && (MODES as ReadonlyArray<string>).includes(value)
  );
}

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
    id: "sunbeam",
    name: "Sunbeam",
    tagline: "The default — ink-black pills with a butter-yellow glow.",
    swatch: "oklch(0.86 0.16 93)",
  },
  {
    id: "violet",
    name: "Violet",
    tagline: "Confident, slightly playful.",
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
