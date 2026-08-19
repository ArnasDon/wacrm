"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, MessageSquare, Pencil, Sparkles, CalendarClock, Send, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ExpandingDialogContent } from "@/components/ui/expanding-dialog-content";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DueDateField } from "./due-date-field";
import { FollowupOutcomeDialog } from "./followup-outcome-dialog";
import { ACTION_ITEM_COLORS } from "@/lib/action-items/constants";
import { completeInterest, editActionItem, rescheduleFollowup } from "@/lib/action-items/queries";
import { renderTemplatePreview } from "@/lib/whatsapp/template-validators";
import type { ActionItem } from "@/types";

type MessageDraft =
  | { mode: "free"; text: string }
  | {
      mode: "template";
      templateId: string;
      templateName: string;
      templateLanguage: string;
      bodyText: string;
      values: string[];
      headerText?: string;
    };

interface ActionItemDetailSheetProps {
  item: ActionItem | null;
  /** The clicked card's own bounding box, captured at click time — see
   *  useFlipTransition. Null/undefined just falls back to a centered
   *  fade/grow, still animated. */
  originRect?: DOMRect | null;
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
export function ActionItemDetailSheet({
  item,
  originRect,
  onClose,
  onChanged,
}: ActionItemDetailSheetProps) {
  const t = useTranslations("ActionCenter.detail");
  const locale = useLocale();
  const { user } = useAuth();

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const [rescheduling, setRescheduling] = useState(false);
  const [newDueDate, setNewDueDate] = useState("");
  const [newDueTime, setNewDueTime] = useState("");

  const [outcomeDialogOpen, setOutcomeDialogOpen] = useState(false);

  const [draft, setDraft] = useState<MessageDraft | null>(null);
  const [generatingMessage, setGeneratingMessage] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setEditing(false);
    setRescheduling(false);
    setDraft(null);
    setSending(false);
    if (item) {
      setEditTitle(item.title);
      setEditDescription(item.description ?? "");
      setNewDueDate(item.due_date ?? "");
      setNewDueTime(item.due_time?.slice(0, 5) ?? "");
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
    if (!newDueDate || !newDueTime) {
      toast.error(t("dueDateRequired"));
      return;
    }
    setSaving(true);
    try {
      const db = createClient();
      await rescheduleFollowup(db, item, newDueDate, newDueTime, null, user?.id ?? null);
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
      const d = payload.draft;
      if (d?.mode === "template") {
        setDraft({
          mode: "template",
          templateId: d.template_id,
          templateName: d.template_name,
          templateLanguage: d.template_language,
          bodyText: d.body_text,
          values: d.values?.body ?? [],
          headerText: d.values?.headerText,
        });
      } else if (d?.mode === "free") {
        setDraft({ mode: "free", text: d.text });
      } else {
        toast.error(t("messageGenerateError"));
      }
    } catch (err) {
      console.error("[action-center] message generate failed:", err);
      toast.error(t("messageGenerateError"));
    } finally {
      setGeneratingMessage(false);
    }
  }

  // "Enviar mensagem" — sends immediately through the CRM's existing
  // send mechanism (same route the Inbox composer uses), no redirect.
  // For a Follow-up, `action_item_id` rides along so /api/whatsapp/send
  // can atomically claim the single-send guard (migration 072) before
  // it calls Meta; a 409 there means this Follow-up was already sent
  // (from this dialog or the other entry point) and is surfaced as-is,
  // never retried silently. On success, hand off straight into the
  // existing "o que aconteceu / próximo passo" flow — sending IS the
  // follow-up contact, so there's no separate "mark done" click needed.
  async function sendMessage() {
    if (!item?.conversation_id || !draft) return;
    setSending(true);
    try {
      const body: Record<string, unknown> = {
        conversation_id: item.conversation_id,
        ...(item.type === "followup" ? { action_item_id: item.id } : {}),
      };
      if (draft.mode === "free") {
        body.message_type = "text";
        body.content_text = draft.text.trim();
      } else {
        const renderedBody = renderTemplatePreview(draft.bodyText, draft.values);
        body.message_type = "template";
        body.template_name = draft.templateName;
        body.template_language = draft.templateLanguage;
        body.template_message_params = { body: draft.values, headerText: draft.headerText };
        body.template_params = draft.values;
        body.content_text = renderedBody;
      }

      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));

      if (res.status === 409) {
        toast.error(t("alreadySentError"));
        onChanged();
        return;
      }
      if (!res.ok) {
        toast.error(payload?.error || t("sendMessageError"));
        return;
      }

      toast.success(t("sentToast"));
      setDraft(null);
      onChanged();
      // Sending IS the follow-up contact — hand off straight into the
      // existing "o que aconteceu / próximo passo" flow instead of a
      // separate "mark done" click. Interest items have no such flow;
      // leave the sheet open so "Marcar como feito" is still available.
      if (item.type === "followup") {
        setOutcomeDialogOpen(true);
      }
    } catch (err) {
      console.error("[action-center] send message failed:", err);
      toast.error(t("sendMessageError"));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
        <DialogPortal>
          <DialogOverlay />
          <ExpandingDialogContent originRect={originRect}>
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
                <DetailRow
                  label={t("dueDateLabel")}
                  value={
                    item.due_time
                      ? `${formatDateLabel(item.due_date, locale)} ${t("atTime", { time: item.due_time.slice(0, 5) })}`
                      : formatDateLabel(item.due_date, locale)
                  }
                />
              )}
            </dl>
          )}

          {rescheduling && (
            <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
              <DueDateField
                dateValue={newDueDate}
                timeValue={newDueTime}
                onDateChange={setNewDueDate}
                onTimeChange={setNewDueTime}
                label={t("newDueDateLabel")}
                id="detail-reschedule-date"
              />
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
                <p className="text-xs font-medium text-muted-foreground">{t("sendMessageLabel")}</p>
                {item.type === "followup" && item.followup_sent_at ? null : (
                  <Button variant="outline" size="sm" onClick={generateMessage} disabled={generatingMessage || sending}>
                    <Sparkles className="h-3.5 w-3.5" />
                    {generatingMessage ? t("generating") : t("generateMessage")}
                  </Button>
                )}
              </div>

              {item.type === "followup" && item.followup_sent_at ? (
                <p className="text-xs text-muted-foreground">{t("alreadySentThisRound")}</p>
              ) : (
                draft && (
                  <>
                    {draft.mode === "free" ? (
                      <Textarea
                        value={draft.text}
                        onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                        rows={4}
                        className="text-xs"
                      />
                    ) : (
                      <div className="space-y-2">
                        <div className="rounded-md border border-border bg-background p-2 text-xs">
                          <p className="mb-1 text-[10px] text-muted-foreground">
                            {t("templateUsed")}: {draft.templateName}
                          </p>
                          <p className="whitespace-pre-wrap text-foreground">
                            {renderTemplatePreview(draft.bodyText, draft.values)}
                          </p>
                        </div>
                        {draft.values.map((v, i) => (
                          <div key={i} className="space-y-1">
                            <Label className="text-[10px] text-muted-foreground">{`{{${i + 1}}}`}</Label>
                            <Input
                              value={v}
                              onChange={(e) => {
                                const next = [...draft.values];
                                next[i] = e.target.value;
                                setDraft({ ...draft, values: next });
                              }}
                              className="h-7 text-xs"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                    <Button size="sm" onClick={sendMessage} disabled={sending}>
                      {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      {sending ? t("sending") : t("sendMessageButton")}
                    </Button>
                  </>
                )
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
          </ExpandingDialogContent>
        </DialogPortal>
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
