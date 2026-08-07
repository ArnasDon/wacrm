"use client";

import { useEffect } from "react";

/**
 * Keeps a `--app-height` custom property on `:root` in sync with the
 * *actual* visible viewport, not the layout viewport (`100vh` /
 * `window.innerHeight`).
 *
 * Why this exists: iOS doesn't reliably shrink `100vh` for the
 * on-screen keyboard, and that unreliability gets *worse* — not
 * better — in a PWA installed via "Adicionar à Tela de Início"
 * (`display: standalone`), which is this app's primary way of being
 * used, not a Safari tab. A container sized with plain `h-screen`
 * either doesn't reflow when the keyboard opens, or reflows against
 * the wrong height, and a bottom-anchored element (the Inbox composer)
 * ends up sitting in the wrong place — sometimes low enough to read as
 * "glued to the edge" even though its own safe-area padding is correct,
 * because the *container* it's positioned within is the wrong height,
 * not the padding.
 *
 * `window.visualViewport` is the API actually designed to track this
 * (it fires `resize`/`scroll` as the keyboard opens/closes and as the
 * visible area shifts) — `100dvh` alone covers most modern cases as a
 * CSS-only baseline, but this is the JS-side correction for whatever
 * `dvh` doesn't handle consistently across iOS/standalone-PWA versions.
 * Consumers should use `h-[var(--app-height,100dvh)]` (or the
 * equivalent inside a `calc()`) so there's still a sane default before
 * this effect's first run and on browsers without `visualViewport`.
 */
export function useViewportHeight() {
  useEffect(() => {
    const root = document.documentElement;

    const setHeight = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      root.style.setProperty("--app-height", `${height}px`);
    };

    setHeight();

    const vv = window.visualViewport;
    vv?.addEventListener("resize", setHeight);
    vv?.addEventListener("scroll", setHeight);
    // Fallback signals for browsers without `visualViewport` (or where
    // it under-fires) — orientation changes and generic resizes.
    window.addEventListener("resize", setHeight);
    window.addEventListener("orientationchange", setHeight);

    return () => {
      vv?.removeEventListener("resize", setHeight);
      vv?.removeEventListener("scroll", setHeight);
      window.removeEventListener("resize", setHeight);
      window.removeEventListener("orientationchange", setHeight);
    };
  }, []);
}
