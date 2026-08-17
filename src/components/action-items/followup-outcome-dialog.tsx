"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
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
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DueDateField } from "./due-date-field";
import { recordFollowupOutcome, rescheduleFollowup, type FollowupOutcome } from "@/lib/action-items/queries";
import { FOLLOWUP_STAGE_NAME } from "@/lib/action-items/constants";
import type { ActionItem } from "@/types";

type Step = "choose" | "continue" | "advanced" | "terminal";

interface FollowupOutcomeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ActionItem | null;
  onDone: () => void;
}

/**
 * "Marcar como feito" on a Follow-up never just removes the card
 * (AGENTS.md §21/§22/§23) — it always asks what happened first, and
 * "Continuar acompanhamento" requires a new date before it can save.
 */
export function FollowupOutcomeDialog({ open, onOpenChange, item, onDone }: FollowupOutcomeDialogProps) {
  const t = useTranslations("ActionCenter.outcomeDialog");
  const { user } = useAuth();
  const { stages, moveToStage } = useLeadPipelineStage(item?.contact_id ?? null);

  const [step, setStep] = useState<Step>("choose");
  const [terminalOutcome, setTerminalOutcome] = useState<FollowupOutcome>("no_response");
  const [note, setNote] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [advanceStageId, setAdvanceStageId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep("choose");
    setNote("");
    setNewDueDate("");
    setAdvanceStageId("");
  }, [open, item?.id]);

  const followupStage = stages.find((s) => s.name.trim().toLowerCase() === FOLLOWUP_STAGE_NAME.toLowerCase());
  const advanceStageOptions = stages.filter((s) => s.id !== followupStage?.id);

  async function handleContinue() {
    if (!item) return;
    if (!newDueDate) {
      toast.error(t("dueDateRequired"));
      return;
    }
    setSaving(true);
    try {
      const db = createClient();
      await rescheduleFollowup(db, item, newDueDate, note.trim() || null, user?.id ?? null);
      toast.success(t("continuedToast"));
      onOpenChange(false);
      onDone();
    } catch (err) {
      console.error("[action-center] reschedule failed:", err);
      toast.error(t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function handleAdvanced() {
    if (!item) return;
    setSaving(true);
    try {
      const db = createClient();
      if (advanceStageId) {
        const { error } = await moveToStage(advanceStageId);
        if (error) throw error;
      }
      await recordFollowupOutcome(db, item, "advanced", note.trim() || null, user?.id ?? null);
      toast.success(t("advancedToast"));
      onOpenChange(false);
      onDone();
    } catch (err) {
      console.error("[action-center] advance failed:", err);
      toast.error(t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function handleTerminal() {
    if (!item) return;
    setSaving(true);
    try {
      const db = createClient();
      await recordFollowupOutcome(db, item, terminalOutcome, note.trim() || null, user?.id ?? null);
      toast.success(t("closedToast"));
      onOpenChange(false);
      onDone();
    } catch (err) {
      console.error("[action-center] outcome failed:", err);
      toast.error(t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>

        {step === "choose" && (
          <div className="space-y-2">
            <OutcomeOption label={t("optionAdvanced")} onClick={() => setStep("advanced")} />
            <OutcomeOption label={t("optionContinue")} onClick={() => setStep("continue")} />
            <OutcomeOption
              label={t("optionNoResponse")}
              onClick={() => {
                setTerminalOutcome("no_response");
                setStep("terminal");
              }}
            />
            <OutcomeOption
              label={t("optionNotInterested")}
              onClick={() => {
                setTerminalOutcome("not_interested");
                setStep("terminal");
              }}
            />
            <OutcomeOption
              label={t("optionEnd")}
              onClick={() => {
                setTerminalOutcome("ended");
                setStep("terminal");
              }}
            />
            <OutcomeOption
              label={t("optionOther")}
              onClick={() => {
                setTerminalOutcome("other");
                setStep("terminal");
              }}
            />
          </div>
        )}

        {step === "continue" && (
          <div className="space-y-4">
            <DueDateField value={newDueDate} onChange={setNewDueDate} label={t("newDueDateLabel")} id="continue-due-date" />
            <div className="space-y-1.5">
              <Label htmlFor="continue-note" className="text-muted-foreground">
                {t("noteLabel")}
              </Label>
              <Textarea id="continue-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("choose")} disabled={saving}>
                {t("back")}
              </Button>
              <Button onClick={handleContinue} disabled={saving}>
                {saving ? t("saving") : t("save")}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "advanced" && (
          <div className="space-y-4">
            {advanceStageOptions.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">{t("advanceStageLabel")}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {advanceStageOptions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setAdvanceStageId(s.id === advanceStageId ? "" : s.id)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                        advanceStageId === s.id ? "border-transparent text-white" : "border-border text-foreground hover:bg-muted"
                      }`}
                      style={advanceStageId === s.id ? { backgroundColor: s.color } : undefined}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="advanced-note" className="text-muted-foreground">
                {t("noteLabel")}
              </Label>
              <Textarea id="advanced-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("choose")} disabled={saving}>
                {t("back")}
              </Button>
              <Button onClick={handleAdvanced} disabled={saving}>
                {saving ? t("saving") : t("save")}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "terminal" && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="terminal-note" className="text-muted-foreground">
                {t("noteLabel")}
              </Label>
              <Textarea id="terminal-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("choose")} disabled={saving}>
                {t("back")}
              </Button>
              <Button onClick={handleTerminal} disabled={saving}>
                {saving ? t("saving") : t("save")}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function OutcomeOption({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border border-border px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-muted"
    >
      {label}
    </button>
  );
}
