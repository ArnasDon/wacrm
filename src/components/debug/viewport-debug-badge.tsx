"use client";

import { useEffect, useState } from "react";

/** TEMPORARY — diagnosing the composer being cut off below the visible
 *  screen in iOS standalone-PWA use (STATUS_PROJETO.md, parte 25).
 *  Unlike the parte-13 version, this one measures the *actual rendered*
 *  numbers (shell height, composer's real bottom edge, the real
 *  `env(safe-area-inset-*)` values applied in context) instead of just
 *  the raw window/viewport APIs — those alone weren't enough to explain
 *  why the composer sits below the fold even after the `dvh +
 *  env(safe-area-inset-top)` shell-height fix. Renders on screen (not
 *  just `console.log`) so it can be read/screenshotted straight off the
 *  installed home-screen app. Remove this component (and its mount in
 *  dashboard-shell.tsx) once the cause is confirmed. */
export function ViewportDebugBadge() {
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    function read() {
      const standalone =
        window.matchMedia?.("(display-mode: standalone)").matches ?? null;

      const shell = document.querySelector<HTMLElement>("[data-debug-shell]");
      const composer = document.querySelector<HTMLElement>(
        "[data-debug-composer]",
      );
      const shellRect = shell?.getBoundingClientRect();
      const composerRect = composer?.getBoundingClientRect();

      // How `env(safe-area-inset-*)` actually resolved *in this exact
      // context* — read straight off the real header/composer elements
      // (which already apply them via padding) rather than a synthetic
      // probe element, so this reflects reality, not a guess.
      const headerEl = document.querySelector<HTMLElement>("header");
      const safeAreaTop = headerEl
        ? getComputedStyle(headerEl).paddingTop
        : "?";
      const safeAreaBottomPx = composer
        ? getComputedStyle(composer).paddingBottom
        : "?";

      const data = {
        standalone,
        innerHeight: window.innerHeight,
        outerHeight: window.outerHeight,
        visualViewportHeight: window.visualViewport?.height ?? null,
        shellHeight: shellRect ? Math.round(shellRect.height) : null,
        shellBottom: shellRect ? Math.round(shellRect.bottom) : null,
        composerBottom: composerRect ? Math.round(composerRect.bottom) : null,
        // Positive = the composer's real bottom edge sits below the
        // visible viewport by this many px (the thing we're trying to
        // measure). Zero or negative = fully visible.
        composerOverflowPx: composerRect
          ? Math.round(composerRect.bottom - window.innerHeight)
          : null,
        safeAreaTop,
        safeAreaBottomPx,
      };
      console.log("[wacrm][viewport-debug]", data);
      setInfo(
        `sa:${data.standalone} iH:${data.innerHeight} oH:${data.outerHeight} ` +
          `shellH:${data.shellHeight} shellBot:${data.shellBottom} ` +
          `compBot:${data.composerBottom} OVERFLOW:${data.composerOverflowPx} ` +
          `satop:${data.safeAreaTop} sabot:${data.safeAreaBottomPx}`,
      );
    }

    read();
    const interval = setInterval(read, 1000);
    window.visualViewport?.addEventListener("resize", read);
    window.addEventListener("resize", read);
    window.addEventListener("orientationchange", read);
    return () => {
      clearInterval(interval);
      window.visualViewport?.removeEventListener("resize", read);
      window.removeEventListener("resize", read);
      window.removeEventListener("orientationchange", read);
    };
  }, []);

  if (!info) return null;

  return (
    <div
      className="pointer-events-none fixed left-1 right-1 z-[999] rounded bg-black/80 px-1.5 py-1 font-mono text-[9px] leading-tight text-lime-400"
      style={{ top: "calc(env(safe-area-inset-top) + 2px)" }}
    >
      {info}
    </div>
  );
}
