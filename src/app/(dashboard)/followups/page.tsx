"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { CalendarClock, Check, Loader2, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Followup } from "@/types";
import { bucketFor, todayIso, type FollowupBucket } from "@/lib/followups/dates";

const ORDER: FollowupBucket[] = ["overdue", "today", "tomorrow", "upcoming"];

export default function FollowupsPage() {
  const t = useTranslations("Followups");
  const router = useRouter();
  const { accountId } = useAuth();
  const [items, setItems] = useState<Followup[] | null>(null);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("conversation_followups")
      .select("*, contact:contacts(name, phone)")
      .eq("account_id", accountId)
      .eq("status", "pending")
      .order("due_date", { ascending: true })
      .limit(500);
    if (err) {
      setError(true);
      return;
    }
    setError(false);
    setItems((data ?? []) as Followup[]);
  }, [accountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const markDone = async (id: string) => {
    setBusyId(id);
    const supabase = createClient();
    const now = new Date().toISOString();
    const { error: err } = await supabase
      .from("conversation_followups")
      .update({ status: "done", completed_at: now, updated_at: now })
      .eq("id", id);
    setBusyId(null);
    if (err) {
      toast.error(t("saveFailed"));
      return;
    }
    setItems((prev) => prev?.filter((f) => f.id !== id) ?? prev);
  };

  if (error) {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center">
        <p className="text-sm text-muted-foreground">{t("loadFailed")}</p>
        <Button className="mt-3" variant="outline" onClick={() => void load()}>
          {t("retry")}
        </Button>
      </div>
    );
  }
  if (items === null) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const today = todayIso();
  const groups = new Map<FollowupBucket, Followup[]>();
  for (const f of items) {
    const b = bucketFor(f.due_date, today);
    groups.set(b, [...(groups.get(b) ?? []), f]);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
          <CalendarClock className="h-5 w-5 text-primary" />
          {t("pageTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
      </div>

      {items.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="font-medium text-foreground">{t("emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("emptyDesc")}</p>
        </div>
      )}

      {ORDER.map((bucket) => {
        const list = groups.get(bucket);
        if (!list?.length) return null;
        return (
          <section key={bucket} className="space-y-2">
            <h2
              className={cn(
                "text-xs font-semibold uppercase tracking-wide",
                bucket === "overdue"
                  ? "text-red-400"
                  : bucket === "today" || bucket === "tomorrow"
                    ? "text-amber-400"
                    : "text-muted-foreground",
              )}
            >
              {t(`group_${bucket}`)} · {list.length}
            </h2>
            <ul className="space-y-2">
              {list.map((f) => {
                const name = f.contact?.name || f.contact?.phone || t("customer");
                return (
                  <li
                    key={f.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {format(parseISO(f.due_date), "dd MMM yyyy")}
                        {f.note ? ` · ${f.note}` : ""}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => router.push(`/inbox?c=${f.conversation_id}`)}
                    >
                      <MessageSquare className="h-4 w-4" />
                      <span className="hidden sm:inline">{t("openChat")}</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busyId === f.id}
                      onClick={() => void markDone(f.id)}
                    >
                      <Check className="h-4 w-4" />
                      <span className="hidden sm:inline">{t("markDone")}</span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
