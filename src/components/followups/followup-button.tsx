"use client";

import { useCallback, useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { CalendarClock, Check, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Followup } from "@/types";
import {
  addDaysIso,
  bucketFor,
  isIsoDate,
  renewalFollowupDate,
  todayIso,
} from "@/lib/followups/dates";

interface Props {
  conversationId: string;
  contactId?: string | null;
}

export function FollowupButton({ conversationId, contactId }: Props) {
  const t = useTranslations("Followups");
  const { user, accountId } = useAuth();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Followup | null>(null);
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [expiry, setExpiry] = useState("");
  const [renewalHint, setRenewalHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("conversation_followups")
      .select("*")
      .eq("conversation_id", conversationId)
      .eq("status", "pending")
      .order("due_date", { ascending: true })
      .limit(1);
    setPending(((data ?? [])[0] as Followup | undefined) ?? null);
  }, [conversationId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const openDialog = () => {
    setDate(pending?.due_date ?? addDaysIso(todayIso(), 1));
    setNote(pending?.note ?? "");
    setExpiry("");
    setRenewalHint(null);
    setOpen(true);
  };

  const applyRenewal = () => {
    if (!isIsoDate(expiry)) return;
    const r = renewalFollowupDate(expiry, todayIso());
    setDate(r.date);
    const expiryLabel = format(parseISO(expiry), "dd MMM yyyy");
    setNote((n) => n || t("renewalNote", { expiry: expiryLabel }));
    setRenewalHint(
      r.windowAlreadyOpen
        ? t("renewalOpenNow")
        : t("renewalSet", { date: format(parseISO(r.date), "dd MMM yyyy") }),
    );
  };

  const save = async () => {
    if (!user || !accountId) return;
    if (!isIsoDate(date) || date < todayIso()) {
      toast.error(t("pastDate"));
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const cleanNote = note.trim() || null;
    const { error } = pending
      ? await supabase
          .from("conversation_followups")
          .update({
            due_date: date,
            note: cleanNote,
            // A rescheduled follow-up gets its reminders again.
            remind_day_before_at: null,
            remind_due_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", pending.id)
      : await supabase.from("conversation_followups").insert({
          account_id: accountId,
          conversation_id: conversationId,
          contact_id: contactId ?? null,
          user_id: user.id,
          due_date: date,
          note: cleanNote,
        });
    setBusy(false);
    if (error) {
      toast.error(t("saveFailed"));
      return;
    }
    toast.success(t("saved"));
    setOpen(false);
    void load();
  };

  const markDone = async () => {
    if (!pending) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("conversation_followups")
      .update({
        status: "done",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", pending.id);
    setBusy(false);
    if (error) {
      toast.error(t("saveFailed"));
      return;
    }
    toast.success(t("done"));
    setOpen(false);
    setPending(null);
  };

  const remove = async () => {
    if (!pending) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("conversation_followups")
      .delete()
      .eq("id", pending.id);
    setBusy(false);
    if (error) {
      toast.error(t("saveFailed"));
      return;
    }
    toast.success(t("removed"));
    setOpen(false);
    setPending(null);
  };

  const today = todayIso();
  const bucket = pending ? bucketFor(pending.due_date, today) : null;
  const label = pending
    ? format(parseISO(pending.due_date), "dd MMM")
    : t("followUp");

  const presets: Array<[string, number]> = [
    [t("presetTomorrow"), 1],
    [t("preset3Days"), 3],
    [t("presetWeek"), 7],
    [t("presetMonth"), 30],
  ];

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        aria-label={pending ? t("followUpOn", { date: label }) : t("followUp")}
        title={pending ? t("followUpOn", { date: label }) : t("followUp")}
        className={cn(
          "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs transition-colors hover:bg-muted hover:text-foreground",
          bucket === "overdue"
            ? "text-red-400"
            : bucket === "today" || bucket === "tomorrow"
              ? "text-amber-400"
              : pending
                ? "text-primary"
                : "text-muted-foreground",
        )}
      >
        <CalendarClock className="h-3.5 w-3.5" />
        <span className={pending ? "" : "hidden sm:inline"}>{label}</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-border bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-popover-foreground">
              <CalendarClock className="h-4 w-4 text-primary" />
              {t("dialogTitle")}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t("reminderInfo")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="followup-date">{t("dateLabel")}</Label>
              <Input
                id="followup-date"
                type="date"
                min={today}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                {presets.map(([text, days]) => (
                  <Button
                    key={days}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setDate(addDaysIso(today, days))}
                  >
                    {text}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2 rounded-md border border-border p-3">
              <Label htmlFor="followup-expiry">{t("expiryLabel")}</Label>
              <div className="flex gap-2">
                <Input
                  id="followup-expiry"
                  type="date"
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!isIsoDate(expiry)}
                  onClick={applyRenewal}
                >
                  {t("useRenewal")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {renewalHint ?? t("expiryHint")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="followup-note">{t("noteLabel")}</Label>
              <Input
                id="followup-note"
                value={note}
                maxLength={300}
                placeholder={t("notePlaceholder")}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <div className="flex gap-2">
              {pending && (
                <>
                  <Button type="button" variant="outline" disabled={busy} onClick={markDone}>
                    <Check className="h-4 w-4" />
                    {t("markDone")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={remove}
                    aria-label={t("remove")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
            <Button type="button" disabled={busy} onClick={save}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
