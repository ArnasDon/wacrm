"use client";

import { useEffect } from "react";

/** Keeps `--app-height` (set synchronously pre-paint by the boot script in
 *  layout.tsx — see `VIEWPORT_BOOT_SCRIPT`) in sync after mount: orientation
 *  changes, the iOS on-screen keyboard opening/closing, and Safari's
 *  collapsing toolbar all change `visualViewport.height` without a page
 *  reload. Deliberately does NOT set the variable on first run — the boot
 *  script already did that before first paint, so re-setting it here on
 *  mount would risk the same "dueling calculation" reflow a JS-only
 *  version of this caused previously (see dashboard-shell.tsx's `h-dvh`
 *  comment history). This hook only *updates* an already-correct value. */
export function useAppHeight() {
  useEffect(() => {
    const root = document.documentElement;

    function set() {
      const height = window.visualViewport?.height ?? window.innerHeight;
      root.style.setProperty("--app-height", `${height}px`);
    }

    window.visualViewport?.addEventListener("resize", set);
    window.addEventListener("resize", set);
    window.addEventListener("orientationchange", set);
    return () => {
      window.visualViewport?.removeEventListener("resize", set);
      window.removeEventListener("resize", set);
      window.removeEventListener("orientationchange", set);
    };
  }, []);
}
