"use client";

import { useEffect } from "react";

/**
 * Registers `/sw.js` once, on the client, from inside the auth-gated
 * dashboard shell (same headless pattern as `PresenceHeartbeat` /
 * `BrowserNotifications`). The SW is what makes the app installable
 * with an offline fallback and — once `feat/web-push` lands — what
 * receives push notifications while the app is closed.
 *
 * `updateViaCache: 'none'` + the `no-store` header on `/sw.js`
 * (next.config.ts) mean the browser re-fetches and byte-diffs the SW
 * file on every load, so a deploy that changes it rolls out promptly.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    // Only register on secure origins (prod HTTPS, or localhost in dev).
    if (!window.isSecureContext) return;

    let cancelled = false;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        if (cancelled) return;

        // Nudge an update check on load; the SW's own skipWaiting +
        // clients.claim take it from there.
        registration.update().catch(() => {});
      } catch (err) {
        console.warn("[pwa] service worker registration failed", err);
      }
    };

    // Wait for the window to settle so registration never competes with
    // first paint / hydration.
    if (document.readyState === "complete") {
      void register();
    } else {
      window.addEventListener("load", register, { once: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
