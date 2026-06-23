"use client";

import { useEffect } from "react";

/**
 * Registers the PWA service worker (`/sw.js`) once on mount. Headless
 * — renders nothing. Mounted app-wide in the root layout so push works
 * regardless of which route the user lands on. Registration is a no-op
 * on browsers without service worker support (older Safari, etc.).
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("[pwa] service worker registration failed:", err);
    });
  }, []);

  return null;
}
