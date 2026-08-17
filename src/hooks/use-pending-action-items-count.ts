"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { listInterestActionItems, listWeekFollowupActionItems } from "@/lib/action-items/queries";

/**
 * Sidebar badge for the Central de Ações nav entry — count of pending
 * Interesses plus this week's pending Follow-ups (the same two lists
 * the page itself renders). Refetches on any `action_items` change and
 * on the local `wacrm:deal-stage-changed` event (a lead being dragged
 * in/out of the Follow-up stage can change the weekly count without
 * an `action_items` row itself changing).
 */
export function usePendingActionItemsCount(): number {
  const { accountId } = useAuth();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!accountId) return;
    const db = createClient();
    try {
      const [interests, followups] = await Promise.all([
        listInterestActionItems(db, accountId),
        listWeekFollowupActionItems(db, accountId),
      ]);
      setCount(interests.length + followups.length);
    } catch {
      // Best-effort badge — a failed count just doesn't update.
    }
  }, [accountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    const channel = supabase
      .channel("action-items-count")
      .on("postgres_changes", { event: "*", schema: "public", table: "action_items" }, refresh)
      .subscribe();
    window.addEventListener("wacrm:deal-stage-changed", refresh);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("wacrm:deal-stage-changed", refresh);
    };
  }, [accountId, refresh]);

  return count;
}
