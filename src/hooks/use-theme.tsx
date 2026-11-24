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
  DEFAULT_MODE,
  DEFAULT_THEME,
  DEFAULT_UI_STYLE,
  MODE_STORAGE_KEY,
  STORAGE_KEY,
  UI_STYLE_PRESETS,
  UI_STYLE_STORAGE_KEY,
  isMode,
  isThemeId,
  isUiStyle,
  type Mode,
  type ThemeId,
  type UiStyle,
} from "@/lib/themes";

/**
 * ThemeProvider — wraps the whole app, owns the three theming axes:
 *   • `theme`   — the accent color (`data-theme` on <html>)
 *   • `mode`    — light / dark (`data-mode` on <html>)
 *   • `uiStyle` — modern / classic interface (`data-ui` on <html>)
 *
 * The boot script in `src/app/layout.tsx` has already applied all
 * three attributes before React hydrates, so by the time this Provider
 * mounts the page is already painted correctly. We just read what's
 * there and keep it in sync going forward.
 *
 * Persistence is localStorage only (device-scoped).
 */

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (next: ThemeId) => void;
  mode: Mode;
  setMode: (next: Mode) => void;
  toggleMode: () => void;
  uiStyle: UiStyle;
  /** Switches the interface and applies that style's default accent + mode. */
  setUiStyle: (next: UiStyle) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readAttr<T>(
  attr: string | undefined,
  key: string,
  guard: (v: unknown) => v is T,
  fallback: T,
): T {
  if (guard(attr)) return attr;
  try {
    const stored = localStorage.getItem(key);
    if (guard(stored)) return stored;
  } catch {
    // localStorage can throw in private-browsing / sandboxed contexts.
  }
  return fallback;
}

function readInitialTheme(): ThemeId {
  if (typeof window === "undefined") return DEFAULT_THEME;
  return readAttr(document.documentElement.dataset.theme, STORAGE_KEY, isThemeId, DEFAULT_THEME);
}

function readInitialMode(): Mode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  return readAttr(document.documentElement.dataset.mode, MODE_STORAGE_KEY, isMode, DEFAULT_MODE);
}

function readInitialUiStyle(): UiStyle {
  if (typeof window === "undefined") return DEFAULT_UI_STYLE;
  return readAttr(document.documentElement.dataset.ui, UI_STYLE_STORAGE_KEY, isUiStyle, DEFAULT_UI_STYLE);
}

function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Same private-browsing edge case as above; in-memory state still
    // updates so the current tab works for the session.
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(readInitialTheme);
  const [mode, setModeState] = useState<Mode>(readInitialMode);
  const [uiStyle, setUiStyleState] = useState<UiStyle>(readInitialUiStyle);

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = next;
    }
    persist(STORAGE_KEY, next);
  }, []);

  const setMode = useCallback((next: Mode) => {
    setModeState(next);
    if (typeof document !== "undefined") {
      document.documentElement.dataset.mode = next;
    }
    persist(MODE_STORAGE_KEY, next);
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === "dark" ? "light" : "dark");
  }, [mode, setMode]);

  const setUiStyle = useCallback(
    (next: UiStyle) => {
      setUiStyleState(next);
      if (typeof document !== "undefined") {
        document.documentElement.dataset.ui = next;
      }
      persist(UI_STYLE_STORAGE_KEY, next);
      const preset = UI_STYLE_PRESETS[next];
      setTheme(preset.theme);
      setMode(preset.mode);
    },
    [setTheme, setMode],
  );

  // Sync from other tabs — change any axis in tab A, tab B catches up
  // without a refresh.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) {
        if (isThemeId(e.newValue) && e.newValue !== theme) {
          setThemeState(e.newValue);
          document.documentElement.dataset.theme = e.newValue;
        }
        return;
      }
      if (e.key === MODE_STORAGE_KEY) {
        if (isMode(e.newValue) && e.newValue !== mode) {
          setModeState(e.newValue);
          document.documentElement.dataset.mode = e.newValue;
        }
        return;
      }
      if (e.key === UI_STYLE_STORAGE_KEY) {
        if (isUiStyle(e.newValue) && e.newValue !== uiStyle) {
          setUiStyleState(e.newValue);
          document.documentElement.dataset.ui = e.newValue;
        }
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [theme, mode, uiStyle]);

  return (
    <ThemeContext.Provider
      value={{ theme, setTheme, mode, setMode, toggleMode, uiStyle, setUiStyle }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Fallback for components rendered outside the provider — return
    // no-op setters so callers don't crash. The boot script still
    // applied the right CSS attributes, so visually the page is fine.
    return {
      theme: DEFAULT_THEME,
      setTheme: () => {},
      mode: DEFAULT_MODE,
      setMode: () => {},
      toggleMode: () => {},
      uiStyle: DEFAULT_UI_STYLE,
      setUiStyle: () => {},
    };
  }
  return ctx;
}
