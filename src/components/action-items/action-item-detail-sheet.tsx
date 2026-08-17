"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, MessageSquare, Pencil, Sparkles, CalendarClock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DueDateField } from "./due-date-field";
import { FollowupOutcomeDialog } from "./followup-outcome-dialog";
import { ACTION_ITEM_COLORS } from "@/lib/action-items/constants";
import { completeInterest, editActionItem, rescheduleFollowup } from "@/lib/action-items/queries";
import { writeFollowupDraft } from "@/lib/inbox/followup-draft";
import { useRouter } from "next/navigation";
import type { ActionItem } from "@/types";

interface ActionItemDetailSheetProps {
  item: ActionItem | null;
  onClose: () => void;
  onChanged: () => void;
}

function formatDateLabel(dateKey: string, locale: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale, { dateStyle: "medium" });
}

/**
 * Detail view opened by clicking any Central de Ações card. Same
 * interaction pattern as the Pipeline's DealDetailDrawer (click → full
 * context in a dialog, never straight into the Inbox) per AGENTS.md §19.
 */
export function ActionItemDetailSheet({ item, onClose, onChanged }: ActionItemDetailSheetProps) {
  const t = useTranslations("ActionCenter.detail");
  const locale = useLocale();
  const router = useRouter();
  const { user } = useAuth();

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const [rescheduling, setRescheduling] = useState(false);
  const [newDueDate, setNewDueDate] = useState("");

  const [outcomeDialogOpen, setOutcomeDialogOpen] = useState(false);

  const [suggestedMessage, setSuggestedMessage] = useState<string | null>(null);
  const [generatingMessage, setGeneratingMessage] = useState(false);

  useEffect(() => {
    setEditing(false);
    setRescheduling(false);
    setSuggestedMessage(null);
    if (item) {
      setEditTitle(item.title);
      setEditDescription(item.description ?? "");
      setNewDueDate(item.due_date ?? "");
    }
  }, [item]);

  if (!item) return null;

  const contact = item.contact;
  const displayName = contact?.name || contact?.phone || t("noContact");
  const color = ACTION_ITEM_COLORS[item.type];
  const stageName = item.deal?.stage?.name;

  async function saveEdit() {
    if (!item) return;
    if (!editTitle.trim()) {
      toast.error(t("titleRequired"));
      return;
    }
    setSaving(true);
    try {
      const db = createClient();
      await editActionItem(
        db,
        item,
        { title: editTitle.trim(), description: editDescription.trim() || null, due_date: item.due_date },
        user?.id ?? null,
      );
      toast.success(t("savedToast"));
      setEditing(false);
      onChanged();
    } catch (err) {
      console.error("[action-center] edit failed:", err);
      toast.error(t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function saveReschedule() {
    if (!item) return;
    if (!newDueDate) {
      toast.error(t("dueDateRequired"));
      return;
    }
    setSaving(true);
    try {
      const db = createClient();
      await rescheduleFollowup(db, item, newDueDate, null, user?.id ?? null);
      toast.success(t("savedToast"));
      setRescheduling(false);
      onChanged();
    } catch (err) {
      console.error("[action-center] reschedule failed:", err);
      toast.error(t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function markInterestDone() {
    if (!item) return;
    setSaving(true);
    try {
      const db = createClient();
      await completeInterest(db, item, user?.id ?? null);
      toast.success(t("doneToast"));
      onChanged();
      onClose();
    } catch (err) {
      console.error("[action-center] complete failed:", err);
      toast.error(t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function generateMessage() {
    if (!item) return;
    setGeneratingMessage(true);
    try {
      const res = await fetch(`/api/action-items/${item.id}/message/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload?.error || t("messageGenerateError"));
        return;
      }
      setSuggestedMessage(payload.text as string);
    } catch (err) {
      console.error("[action-center] message generate failed:", err);
      toast.error(t("messageGenerateError"));
    } finally {
      setGeneratingMessage(false);
    }
  }

  function useSuggestedMessage() {
    if (!item?.conversation_id || !suggestedMessage) return;
    writeFollowupDraft(item.conversation_id, {
      suggestionId: item.id,
      mode: "free",
      text: suggestedMessage,
    });
    router.push(`/inbox?c=${item.conversation_id}`);
  }

  return (
    <>
      <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
              <DialogTitle className="truncate">{displayName}</DialogTitle>
            </div>
            {contact?.phone && <DialogDescription>{contact.phone}</DialogDescription>}
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" style={{ borderColor: `${color}66`, color }}>
              {item.type === "interest" ? t("typeInterest") : t("typeFollowup")}
            </Badge>
            {stageName && (
              <Badge variant="outline" className="text-muted-foreground">
                {t("stagePrefix")} {stageName}
              </Badge>
            )}
          </div>

          {editing ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-title" className="text-muted-foreground">
                  {item.type === "interest" ? t("interestTitleLabel") : t("followupTitleLabel")}
                </Label>
                <Input id="edit-title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-desc" className="text-muted-foreground">
                  {t("contextLabel")}
                </Label>
                <Textarea id="edit-desc" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={3} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={saving}>
                  {t("cancel")}
                </Button>
                <Button size="sm" onClick={saveEdit} disabled={saving}>
                  {saving ? t("saving") : t("save")}
                </Button>
              </div>
            </div>
          ) : (
            <dl className="space-y-3 text-sm">
              <DetailRow label={item.type === "interest" ? t("interestTitleLabel") : t("followupTitleLabel")} value={item.title} multiline />
              <DetailRow label={t("contextLabel")} value={item.description || t("noContext")} multiline />
              {item.type === "followup" && item.due_date && (
                <DetailRow label={t("dueDateLabel")} value={formatDateLabel(item.due_date, locale)} />
              )}
            </dl>
          )}

          {rescheduling && (
            <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
              <DueDateField value={newDueDate} onChange={setNewDueDate} label={t("newDueDateLabel")} id="detail-reschedule-date" />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setRescheduling(false)} disabled={saving}>
                  {t("cancel")}
                </Button>
                <Button size="sm" onClick={saveReschedule} disabled={saving}>
                  {saving ? t("saving") : t("save")}
                </Button>
              </div>
            </div>
          )}

          {item.conversation_id && (
            <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">{t("suggestedMessageLabel")}</p>
                <Button variant="outline" size="sm" onClick={generateMessage} disabled={generatingMessage}>
                  <Sparkles className="h-3.5 w-3.5" />
                  {generatingMessage ? t("generating") : t("suggestMessage")}
                </Button>
              </div>
              {suggestedMessage && (
                <>
                  <Textarea
                    value={suggestedMessage}
                    onChange={(e) => setSuggestedMessage(e.target.value)}
                    rows={3}
                    className="text-xs"
                  />
                  <Button size="sm" onClick={useSuggestedMessage}>
                    {t("useInWhatsapp")}
                  </Button>
                </>
              )}
            </div>
          )}

          <DialogFooter className="flex-wrap items-center gap-2 sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {item.conversation_id && (
                <Button variant="outline" size="sm" render={<Link href={`/inbox?c=${item.conversation_id}`} />}>
                  <MessageSquare className="h-4 w-4" />
                  {t("openConversation")}
                </Button>
              )}
              {!editing && (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  <Pencil className="h-4 w-4" />
                  {t("edit")}
                </Button>
              )}
              {item.type === "followup" && !rescheduling && (
                <Button variant="outline" size="sm" onClick={() => setRescheduling(true)}>
                  <CalendarClock className="h-4 w-4" />
                  {t("reschedule")}
                </Button>
              )}
            </div>
            <Button
              size="sm"
              onClick={() => (item.type === "interest" ? markInterestDone() : setOutcomeDialogOpen(true))}
              disabled={saving}
            >
              <Check className="h-4 w-4" />
              {t("markDone")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FollowupOutcomeDialog
        open={outcomeDialogOpen}
        onOpenChange={setOutcomeDialogOpen}
        item={item}
        onDone={() => {
          onChanged();
          onClose();
        }}
      />
    </>
  );
}

function DetailRow({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-foreground ${multiline ? "whitespace-pre-wrap" : ""}`}>{value}</dd>
    </div>
  );
}
