/**
 * Single source of truth for the desktop sidebar's collapsed state.
 *
 * The preference is device-scoped (localStorage), exactly like the
 * theme/mode pair in `src/lib/themes.ts`, and is mirrored onto
 * `<html data-sidebar-state="...">` by the boot script in
 * `src/app/[locale]/layout.tsx`. Keying the rail styles off that
 * attribute (see the `rail:` variant in `src/app/globals.css`) means
 * the collapsed width is painted before React hydrates — no flash of
 * a full-width sidebar, and no hydration mismatch, because the markup
 * React renders is identical either way.
 *
 * Only meaningful at `lg` and up. Below that the sidebar is an
 * off-canvas drawer, so every rail style is `lg:`-gated and this
 * preference is ignored.
 */

export const SIDEBAR_STATES = ["expanded", "collapsed"] as const;

export type SidebarState = (typeof SIDEBAR_STATES)[number];

export const DEFAULT_SIDEBAR_STATE: SidebarState = "expanded";

export const SIDEBAR_STORAGE_KEY = "wacrm.sidebar";

export function isSidebarState(value: unknown): value is SidebarState {
  return (
    typeof value === "string" &&
    (SIDEBAR_STATES as ReadonlyArray<string>).includes(value)
  );
}
