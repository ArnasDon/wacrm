"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Notification } from "@/types";

/**
 * BrowserNotifications — headless, mounted once in the dashboard shell
 * (same pattern as `PresenceHeartbeat`). Shows a native Chrome/OS
 * notification for conversation assignments and pending AI handoffs
 * to the signed-in agent. Assignment triggers and direct AI handoff
 * inserts both publish through the notifications table.
 *
 * Relies on the same realtime channel + RLS scoping as
 * `useUnreadNotifications` — every row this tab receives already belongs
 * to the signed-in user.
 */
export function BrowserNotifications() {
  const { accountId } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!accountId) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;

    // Ask once per browser profile. Chrome remembers the answer, so this
    // is a no-op on every later mount once the user has granted or
    // denied it; only 'default' (never asked) prompts.
    if (Notification.permission === "default") {
      void Notification.requestPermission();
    }

    const supabase = createClient();
    const channel = supabase
      .channel("notifications-browser-alert")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          if (Notification.permission !== "granted") return;
          const row = payload.new as Notification;
          if (row.type !== "conversation_assigned" && row.type !== "ai_handoff") return;

          const n = new Notification(row.title, {
            body: row.body ?? undefined,
            tag: row.id,
          });
          n.onclick = () => {
            window.focus();
            if (row.conversation_id) {
              router.push(`/inbox?c=${row.conversation_id}`);
            }
            n.close();
          };
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId, router]);

  return null;
}
