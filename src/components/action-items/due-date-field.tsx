"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { localDayKey } from "@/lib/action-items/date-utils";

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDayKey(d);
}

interface DueDateFieldProps {
  dateValue: string;
  timeValue: string;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  label: string;
  id?: string;
}

/** Shared "próximo contato" date+hora field — native date/time inputs
 *  plus the +10/+20/+30 dias shortcuts required by AGENTS.md §5/§22
 *  (shortcuts only ever touch the date; the time is always a deliberate
 *  choice). Both date and time are required wherever a Follow-up is
 *  created or rescheduled — the global "motivo + prazo (data e hora)"
 *  rule for entering Follow-up. Used when creating/editing a follow-up,
 *  rescheduling one, and by the cross-cutting move-to-Follow-up gate
 *  (useFollowupGate). */
export function DueDateField({
  dateValue,
  timeValue,
  onDateChange,
  onTimeChange,
  label,
  id = "due-date",
}: DueDateFieldProps) {
  const t = useTranslations("ActionCenter.dueDateShortcuts");
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-muted-foreground">
        {label}
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          type="date"
          value={dateValue}
          onChange={(e) => onDateChange(e.target.value)}
          className="w-auto"
        />
        <Input
          id={`${id}-time`}
          type="time"
          value={timeValue}
          onChange={(e) => onTimeChange(e.target.value)}
          className="w-auto"
          aria-label={t("timeLabel")}
        />
        <div className="flex gap-1">
          <Button type="button" variant="outline" size="sm" onClick={() => onDateChange(addDays(10))}>
            {t("plus10")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onDateChange(addDays(20))}>
            {t("plus20")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onDateChange(addDays(30))}>
            {t("plus30")}
          </Button>
        </div>
      </div>
    </div>
  );
}
