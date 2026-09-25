"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  ACCENT_STORAGE_KEY,
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODE_STORAGE_KEY,
  STORAGE_KEY,
  accentVars,
  isModeId,
  isThemeId,
  normalizeHex,
  type ModeId,
  type ThemeId,
} from "@/lib/themes";

/**
 * ThemeProvider — wraps the whole app, owns the active theme state.
 *
 * The boot script in `src/app/layout.tsx` has already applied
 * `document.documentElement.dataset.theme` before React hydrates, so
 * by the time this Provider mounts the page is already painted in
 * the right colors. We just have to read what's there and keep it
 * in sync going forward.
 *
 * Persistence is localStorage only (device-scoped). A future
 * follow-up could mirror to `profiles.preferences` for cross-device
 * sync, but a per-device choice is also defensible — your phone may
 * deserve a different theme than your laptop.
 */

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (next: ThemeId) => void;
  /** Light or dark surfaces. Independent of the accent. */
  mode: ModeId;
  setMode: (next: ModeId) => void;
  /** Custom accent hex, or null when one of the presets is in use. */
  accent: string | null;
  setAccent: (next: string | null) => void;
}

/** Writes (or clears) the inline accent properties on <html>. */
function applyAccent(hex: string | null) {
  const root = document.documentElement;
  const vars = accentVars("#000000");
  if (!hex) {
    for (const name of Object.keys(vars)) root.style.removeProperty(name);
    return;
  }
  for (const [name, value] of Object.entries(accentVars(hex))) {
    root.style.setProperty(name, value);
  }
}

function readInitialMode(): ModeId {
  if (typeof window === "undefined") return DEFAULT_MODE;
  const fromAttr = document.documentElement.dataset.mode;
  if (isModeId(fromAttr)) return fromAttr;
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    if (isModeId(stored)) return stored;
  } catch {
    // private browsing
  }
  return DEFAULT_MODE;
}

function readInitialAccent(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return normalizeHex(localStorage.getItem(ACCENT_STORAGE_KEY));
  } catch {
    return null;
  }
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readInitialTheme(): ThemeId {
  if (typeof window === "undefined") return DEFAULT_THEME;
  // Whatever the boot script applied is the truth. Fall back to
  // localStorage / default if for some reason the attribute is missing
  // (e.g. someone bypassed the boot script in a custom layout).
  const fromAttr = document.documentElement.dataset.theme;
  if (isThemeId(fromAttr)) return fromAttr;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isThemeId(stored)) return stored;
  } catch {
    // localStorage can throw in private-browsing / sandboxed contexts.
  }
  return DEFAULT_THEME;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(readInitialTheme);
  const [mode, setModeState] = useState<ModeId>(readInitialMode);
  const [accent, setAccentState] = useState<string | null>(readInitialAccent);

  const setMode = useCallback((next: ModeId) => {
    setModeState(next);
    document.documentElement.dataset.mode = next;
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // private browsing
    }
  }, []);

  // Picking a preset clears the custom colour, and vice versa — two
  // accents fighting over --primary would be nobody's idea of a theme.
  const setAccent = useCallback((next: string | null) => {
    const hex = next ? normalizeHex(next) : null;
    setAccentState(hex);
    applyAccent(hex);
    try {
      if (hex) localStorage.setItem(ACCENT_STORAGE_KEY, hex);
      else localStorage.removeItem(ACCENT_STORAGE_KEY);
    } catch {
      // private browsing
    }
  }, []);

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    setAccentState(null);
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = next;
      applyAccent(null);
    }
    try {
      localStorage.removeItem(ACCENT_STORAGE_KEY);
    } catch {
      // private browsing
    }
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Same private-browsing edge case as above; the in-memory state
      // still updates so the current tab works for the session.
    }
  }, []);

  // Sync from other tabs — if you change your theme in tab A, tab B
  // catches up without a refresh.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      if (isThemeId(e.newValue) && e.newValue !== theme) {
        setThemeState(e.newValue);
        document.documentElement.dataset.theme = e.newValue;
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, mode, setMode, accent, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Fallback for components rendered outside the provider — return a
    // no-op setter so callers don't crash. The boot script still
    // applied the right CSS attribute, so visually the page is fine.
    return {
      theme: DEFAULT_THEME,
      setTheme: () => {},
      mode: DEFAULT_MODE,
      setMode: () => {},
      accent: null,
      setAccent: () => {},
    };
  }
  return ctx;
}
