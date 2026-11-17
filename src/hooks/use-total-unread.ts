"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPages } from "@/lib/supabase/paged-query";
import { applyUnreadChange, type UnreadChange } from "@/lib/inbox/unread-set";

/**
 * Count of conversations with at least one unread inbound message for
 * the current user. Used by the sidebar to surface a green dot on the
 * Inbox nav entry when the user is elsewhere in the app.
 *
 * Lives on its own realtime channel (distinct from the inbox page's
 * "inbox-realtime") so both can coexist without sharing state.
 */
export function useTotalUnread(): number {
  const [total, setTotal] = useState(0);

  const unreadIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    // Initial load. RLS scopes this to the signed-in user automatically —
    // no explicit user_id filter needed here.
    (async () => {
      let rows: { id: string }[];
      try {
        rows = await fetchAllPages<{ id: string }>((from, to) =>
          supabase
            .from("conversations")
            .select("id")
            .gt("unread_count", 0)
            .order("id")
            .range(from, to),
        );
      } catch {
        return;
      }
      if (cancelled) return;
      const unreadIds = unreadIdsRef.current;
      for (const row of rows) unreadIds.add(row.id);
      setTotal(unreadIds.size);
    })();

    const channel = supabase
      .channel("total-unread-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        (payload) => {
          const unreadIds = unreadIdsRef.current;
          applyUnreadChange(unreadIds, payload as unknown as UnreadChange);
          setTotal(unreadIds.size);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  return total;
}
