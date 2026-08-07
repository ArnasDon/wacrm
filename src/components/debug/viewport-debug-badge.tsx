"use client";

import { useEffect, useState } from "react";

/** TEMPORARY — diagnosing the "black bar" reported at the bottom of the
 *  screen in iOS standalone-PWA use (STATUS_PROJETO.md, parte 13). Renders
 *  the raw viewport numbers directly on screen (not just `console.log`) so
 *  they can be read/screenshotted straight off the installed home-screen
 *  app, without needing a Mac + cable + Safari Web Inspector attached.
 *  Remove this component (and its mount in dashboard-shell.tsx) once the
 *  cause is confirmed. */
export function ViewportDebugBadge() {
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    function read() {
      const standalone =
        window.matchMedia?.("(display-mode: standalone)").matches ?? null;
      const navStandalone =
        (window.navigator as Navigator & { standalone?: boolean })
          .standalone ?? null;
      const data = {
        innerHeight: window.innerHeight,
        outerHeight: window.outerHeight,
        visualViewportHeight: window.visualViewport?.height ?? null,
        displayModeStandalone: standalone,
        navigatorStandalone: navStandalone,
      };
      console.log("[wacrm][viewport-debug]", data);
      setInfo(
        `iH:${data.innerHeight} oH:${data.outerHeight} vv:${data.visualViewportHeight ?? "?"} standalone:${data.displayModeStandalone} nav:${data.navigatorStandalone}`,
      );
    }

    read();
    window.visualViewport?.addEventListener("resize", read);
    window.addEventListener("resize", read);
    window.addEventListener("orientationchange", read);
    return () => {
      window.visualViewport?.removeEventListener("resize", read);
      window.removeEventListener("resize", read);
      window.removeEventListener("orientationchange", read);
    };
  }, []);

  if (!info) return null;

  return (
    <div
      className="pointer-events-none fixed right-1 z-[999] rounded bg-black/70 px-1.5 py-0.5 font-mono text-[9px] leading-tight text-lime-400"
      style={{ top: "calc(env(safe-area-inset-top) + 2px)" }}
    >
      {info}
    </div>
  );
}
