"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DueDateField } from "./due-date-field";
import type { FollowupGate } from "@/hooks/use-followup-gate";

/**
 * The one shared "motivo + prazo" prompt every move-to-Follow-up path
 * funnels through (AGENTS task). Purely presentational — all the
 * decision logic (when to open, what to save, what to do on confirm)
 * lives in {@link useFollowupGate}; this just renders whatever that
 * hook hands it. Spread its return value directly: `<FollowupRequirementDialog {...followupGate} />`.
 */
export function FollowupRequirementDialog({
  open,
  saving,
  contactName,
  cancel,
  confirm,
}: FollowupGate) {
  const t = useTranslations("ActionCenter.followupGate");
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTitle("");
    setDueDate("");
    setDueTime("");
  }, [open]);

  const canConfirm = !!title.trim() && !!dueDate && !!dueTime;

  function handleConfirm() {
    if (!canConfirm) return;
    void confirm(title.trim(), dueDate, dueTime);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && cancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title", { name: contactName })}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="followup-gate-reason" className="text-muted-foreground">
              {t("reasonLabel")}
            </Label>
            <Textarea
              id="followup-gate-reason"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("reasonPlaceholder")}
              rows={2}
              disabled={saving}
            />
          </div>
          <DueDateField
            dateValue={dueDate}
            timeValue={dueTime}
            onDateChange={setDueDate}
            onTimeChange={setDueTime}
            label={t("dueDateLabel")}
            id="followup-gate-date"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={cancel} disabled={saving}>
            {t("cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={saving || !canConfirm}>
            {saving ? t("saving") : t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
