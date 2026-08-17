"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ListChecks, Loader2, Target } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  listInterestActionItems,
  listWeekFollowupActionItems,
} from "@/lib/action-items/queries";
import { ActionItemCard } from "@/components/action-items/action-item-card";
import { ActionItemDetailSheet } from "@/components/action-items/action-item-detail-sheet";
import { AssignedNotificationsPopover } from "@/components/action-items/assigned-notifications-popover";
import type { ActionItem } from "@/types";

export default function ActionCenterPage() {
  const t = useTranslations("ActionCenter.page");
  const { accountId } = useAuth();
  const [interests, setInterests] = useState<ActionItem[] | null>(null);
  const [followups, setFollowups] = useState<ActionItem[] | null>(null);
  const [selected, setSelected] = useState<ActionItem | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    const db = createClient();
    const [interestRows, followupRows] = await Promise.all([
      listInterestActionItems(db, accountId),
      listWeekFollowupActionItems(db, accountId),
    ]);
    setInterests(interestRows);
    setFollowups(followupRows);
  }, [accountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Realtime — a card created/edited/completed from the Inbox or
  // Pipeline (or another tab) shows up here without a refresh. Also
  // listens for the Pipeline's own stage-move event, since dragging a
  // lead in/out of the Follow-up stage changes the weekly list without
  // touching action_items itself (§29).
  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    const channel = supabase
      .channel("action-center-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "action_items" }, load)
      .subscribe();
    window.addEventListener("wacrm:deal-stage-changed", load);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("wacrm:deal-stage-changed", load);
    };
  }, [accountId, load]);

  const loading = interests === null || followups === null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <AssignedNotificationsPopover />
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <section>
            <SectionHeader icon={Target} title={t("interestsTitle")} count={interests.length} />
            {interests.length === 0 ? (
              <EmptyState message={t("interestsEmpty")} />
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {interests.map((item) => (
                  <ActionItemCard key={item.id} item={item} onClick={() => setSelected(item)} />
                ))}
              </div>
            )}
          </section>

          <div className="border-t border-border" />

          <section>
            <SectionHeader icon={ListChecks} title={t("followupsTitle")} count={followups.length} />
            {followups.length === 0 ? (
              <EmptyState message={t("followupsEmpty")} />
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {followups.map((item) => (
                  <ActionItemCard key={item.id} item={item} onClick={() => setSelected(item)} />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <ActionItemDetailSheet item={selected} onClose={() => setSelected(null)} onChanged={load} />
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  count,
}: {
  icon: typeof Target;
  title: string;
  count: number;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">
        {count}
      </span>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-border bg-muted/40">
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}
