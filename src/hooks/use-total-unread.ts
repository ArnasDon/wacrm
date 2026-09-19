"use client";

import { useEffect, useState } from "react";

/**
 * Conversations with unread customer messages, for the sidebar dot.
 * Polls every 20s (the MongoDB deployment is a standalone node, so
 * there are no change streams to push from). Pauses while the tab is
 * hidden.
 */
export function useTotalUnread(): number {
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch("/api/conversations/unread", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { unread?: number };
        if (!cancelled) setTotal(body.unread ?? 0);
      } catch {
        /* offline — keep last value */
      }
    };
    void load();
    const t = setInterval(load, 20_000);
    document.addEventListener("visibilitychange", load);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", load);
    };
  }, []);

  return total;
}
