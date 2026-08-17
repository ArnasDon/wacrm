"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useLeadPipelineStage } from "@/hooks/use-lead-pipeline-stage";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DueDateField } from "./due-date-field";
import {
  createActionItem,
  editActionItem,
  findActivePendingActionItem,
} from "@/lib/action-items/queries";
import { FOLLOWUP_STAGE_NAME } from "@/lib/action-items/constants";
import type { ActionItem, ActionItemType } from "@/types";

interface AiHint {
  id: string;
  title: string;
  description: string | null;
}

interface AddToActionCenterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
  conversationId?: string | null;
  defaultType?: ActionItemType;
  onSaved?: () => void;
}

/**
 * "Adicionar à Central de Ações" — the shared entry point opened from
 * both the Inbox (conversation ⋮ menu) and the Pipeline (deal detail
 * drawer), per AGENTS.md §7. Handles both sub-flows (Interesse /
 * Follow-up), duplicate prevention (§10), the Follow-up move-to-stage
 * confirmation (§9), and AI-assisted prefill from an existing pending
 * ai_suggestion for this contact (§6/§8) — never a fresh AI call.
 */
export function AddToActionCenterDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
  conversationId,
  defaultType = "interest",
  onSaved,
}: AddToActionCenterDialogProps) {
  const t = useTranslations("ActionCenter.addDialog");
  const { accountId, user } = useAuth();
  const { deal, stages, moveToStage } = useLeadPipelineStage(contactId);

  const [type, setType] = useState<ActionItemType>(defaultType);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [existing, setExisting] = useState<ActionItem | null>(null);
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  const [aiHint, setAiHint] = useState<AiHint | null>(null);
  const [confirmMove, setConfirmMove] = useState(false);
  const [saving, setSaving] = useState(false);

  function resetForm() {
    setTitle("");
    setDescription("");
    setDueDate("");
    setExisting(null);
    setShowDuplicateWarning(false);
    setAiHint(null);
    setConfirmMove(false);
  }

  useEffect(() => {
    if (!open) return;
    setType(defaultType);
  }, [open, defaultType]);

  // Load duplicate-check + AI hint whenever the dialog is open and the
  // chosen type changes.
  useEffect(() => {
    if (!open || !contactId) return;
    resetForm();
    const db = createClient();
    let cancelled = false;

    (async () => {
      const active = await findActivePendingActionItem(db, contactId, type);
      if (cancelled) return;

      if (active) {
        if (type === "followup") {
          // Follow-up: reuse/reprogram the existing one directly (§9)
          // — no separate warning step, just edit-in-place.
          setExisting(active);
          setTitle(active.title);
          setDescription(active.description ?? "");
          setDueDate(active.due_date ?? "");
        } else {
          // Interesse: surface the duplicate-prevention choice (§10)
          // instead of silently editing or silently duplicating.
          setExisting(active);
          setShowDuplicateWarning(true);
        }
      }

      const { data: suggestion } = await db
        .from("ai_suggestions")
        .select("id, title, description")
        .eq("contact_id", contactId)
        .eq("status", "pending")
        .eq("category", type === "followup" ? "followup" : "action")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled && suggestion) {
        setAiHint({
          id: suggestion.id as string,
          title: suggestion.title as string,
          description: (suggestion.description as string | null) ?? null,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, contactId, type]);

  function useAiHint() {
    if (!aiHint) return;
    setTitle(aiHint.title);
    setDescription(aiHint.description ?? "");
  }

  function editExistingInstead() {
    if (!existing) return;
    setTitle(existing.title);
    setDescription(existing.description ?? "");
    setShowDuplicateWarning(false);
  }

  function createAnywayInstead() {
    setExisting(null);
    setShowDuplicateWarning(false);
  }

  const followupStage = stages.find(
    (s) => s.name.trim().toLowerCase() === FOLLOWUP_STAGE_NAME.toLowerCase(),
  );
  const needsStageMoveConfirm =
    type === "followup" && !!deal && !!followupStage && deal.stage_id !== followupStage.id;

  async function doSave() {
    if (!accountId) return;
    if (!title.trim()) {
      toast.error(t("titleRequired"));
      return;
    }
    if (type === "followup" && !dueDate) {
      toast.error(t("dueDateRequired"));
      return;
    }
    if (needsStageMoveConfirm && !confirmMove) {
      setConfirmMove(true);
      return;
    }

    setSaving(true);
    try {
      const db = createClient();

      if (needsStageMoveConfirm && followupStage) {
        const { error } = await moveToStage(followupStage.id);
        if (error) throw error;
      }

      // The item being edited in place — either an existing pending
      // follow-up being reprogrammed, or the user explicitly chose
      // "Editar existente" on an Interesse duplicate.
      const editingExisting = existing && (type === "followup" || !showDuplicateWarning);

      if (editingExisting && existing) {
        await editActionItem(
          db,
          existing,
          { title: title.trim(), description: description.trim() || null, due_date: type === "followup" ? dueDate : null },
          user?.id ?? null,
        );
      } else {
        await createActionItem(db, {
          account_id: accountId,
          contact_id: contactId,
          deal_id: deal?.id ?? null,
          conversation_id: conversationId ?? null,
          type,
          title: title.trim(),
          description: description.trim() || null,
          due_date: type === "followup" ? dueDate : null,
          source_suggestion_id: aiHint?.id ?? null,
          created_by: user?.id ?? null,
        });
      }

      toast.success(t("savedToast"));
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      console.error("[action-center] save failed:", err);
      toast.error(t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title", { name: contactName })}</DialogTitle>
        </DialogHeader>

        {confirmMove ? (
          <div className="space-y-4">
            <p className="text-sm text-foreground">{t("confirmMoveMessage")}</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmMove(false)} disabled={saving}>
                {t("cancel")}
              </Button>
              <Button onClick={doSave} disabled={saving}>
                {saving ? t("saving") : t("confirm")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <Tabs value={type} onValueChange={(v) => setType(v as ActionItemType)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="interest">{t("tabInterest")}</TabsTrigger>
              <TabsTrigger value="followup">{t("tabFollowup")}</TabsTrigger>
            </TabsList>

            {type === "interest" && showDuplicateWarning && existing ? (
              <div className="mt-3 space-y-3 rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-sm text-foreground">{t("duplicateInterestMessage")}</p>
                <div className="rounded-md border border-border bg-card p-2 text-sm">
                  <p className="font-medium text-foreground">{existing.title}</p>
                  {existing.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{existing.description}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={editExistingInstead}>
                    {t("editExisting")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={createAnywayInstead}>
                    {t("createAnyway")}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <TabsContent value="interest" className="mt-3 space-y-3">
                  {aiHint && (
                    <AiHintBanner text={aiHint.title} onUse={useAiHint} label={t("aiSuggested")} useLabel={t("useSuggestion")} />
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="interest-title" className="text-muted-foreground">
                      {t("interestTitleLabel")}
                    </Label>
                    <Input
                      id="interest-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder={t("interestTitlePlaceholder")}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="interest-desc" className="text-muted-foreground">
                      {t("contextLabel")}
                    </Label>
                    <Textarea
                      id="interest-desc"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={t("contextPlaceholder")}
                      rows={3}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="followup" className="mt-3 space-y-3">
                  {existing && (
                    <p className="text-xs text-muted-foreground">{t("reprogrammingExisting")}</p>
                  )}
                  {aiHint && (
                    <AiHintBanner text={aiHint.title} onUse={useAiHint} label={t("aiSuggested")} useLabel={t("useSuggestion")} />
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="followup-title" className="text-muted-foreground">
                      {t("followupTitleLabel")}
                    </Label>
                    <Input
                      id="followup-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder={t("followupTitlePlaceholder")}
                    />
                  </div>
                  <DueDateField value={dueDate} onChange={setDueDate} label={t("dueDateLabel")} id="followup-due-date" />
                  <div className="space-y-1.5">
                    <Label htmlFor="followup-desc" className="text-muted-foreground">
                      {t("observationLabel")}
                    </Label>
                    <Textarea
                      id="followup-desc"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={t("observationPlaceholder")}
                      rows={2}
                    />
                  </div>
                </TabsContent>

                <DialogFooter>
                  <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                    {t("cancel")}
                  </Button>
                  <Button onClick={doSave} disabled={saving}>
                    {saving ? t("saving") : t("save")}
                  </Button>
                </DialogFooter>
              </>
            )}
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AiHintBanner({
  text,
  onUse,
  label,
  useLabel,
}: {
  text: string;
  onUse: () => void;
  label: string;
  useLabel: string;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-xs">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{label}</p>
        <p className="mt-0.5 line-clamp-2 text-muted-foreground">{text}</p>
      </div>
      <Button size="sm" variant="outline" className="shrink-0" onClick={onUse}>
        {useLabel}
      </Button>
    </div>
  );
}
