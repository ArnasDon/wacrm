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
  value: string;
  onChange: (value: string) => void;
  label: string;
  id?: string;
}

/** Shared "próximo contato" date field — native date input + the
 *  +10/+20/+30 dias shortcuts required by AGENTS.md §5/§22. Used both
 *  when creating/editing a follow-up and when rescheduling one. */
export function DueDateField({ value, onChange, label, id = "due-date" }: DueDateFieldProps) {
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
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-auto"
        />
        <div className="flex gap-1">
          <Button type="button" variant="outline" size="sm" onClick={() => onChange(addDays(10))}>
            {t("plus10")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onChange(addDays(20))}>
            {t("plus20")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onChange(addDays(30))}>
            {t("plus30")}
          </Button>
        </div>
      </div>
    </div>
  );
}
