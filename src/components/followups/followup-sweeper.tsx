"use client";

import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";

// Headless. Asks the server to create any due follow-up reminders when a
// signed-in user opens WACRM (at most every 10 minutes per tab session).
// It is a safety net: the scheduled job normally does this in the background.
export function FollowupSweeper() {
  const { user } = useAuth();
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    const key = "wacrm:followup-sweep";
    try {
      const last = Number(window.sessionStorage.getItem(key) || 0);
      if (Date.now() - last < 10 * 60_000) return;
      window.sessionStorage.setItem(key, String(Date.now()));
    } catch {
      /* storage blocked: just run */
    }
    void fetch("/api/followups/process", {
      method: "POST",
      credentials: "same-origin",
    }).catch(() => undefined);
  }, [userId]);

  return null;
}
