"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  notificationsAccountFilter,
  unreadCountChange,
} from "@/lib/notifications/unread-count";
import type { Notification } from "@/types";

/**
 * Count of unread notifications for the current user. Used by the
 * sidebar to surface a badge on the Notifications nav entry.
 */
export function useUnreadNotifications(): number {
  const { accountId } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    let cancelled = false;

    const loadCount = async () => {
      // head:true skips fetching rows — we only need the `count`
      // supabase-js returns alongside the (empty) response body.
      const { count: unreadCount, error } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("account_id", accountId)
        .is("read_at", null);
      if (cancelled || error) return;
      setCount(unreadCount ?? 0);
    };

    void loadCount();

    const channel = supabase
      .channel(`notifications-unread-count:${accountId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: notificationsAccountFilter(accountId),
        },
        (payload) => {
          const change = unreadCountChange(
            {
              eventType: payload.eventType,
              new: payload.new as Partial<Notification>,
              old: payload.old as Partial<Notification>,
            },
            accountId,
          );
          if (change.kind === "refetch") {
            void loadCount();
          } else if (change.delta !== 0) {
            setCount((n) => Math.max(0, n + change.delta));
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [accountId]);

  return accountId ? count : 0;
}
