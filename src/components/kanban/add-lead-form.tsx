"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Contact, FunnelStage } from "@/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface AddLeadFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stages: FunnelStage[];
  existingContactIds: Set<string>;
  onCreated: () => void;
}

/**
 * Manually drop an existing contact into the funnel — the exception
 * path to the normal "first inbound message" auto-entry, for contacts
 * who were imported/added but never messaged (or a lead the team wants
 * to track from an offline channel).
 */
export function AddLeadForm({
  open,
  onOpenChange,
  stages,
  existingContactIds,
  onCreated,
}: AddLeadFormProps) {
  const supabase = createClient();
  const { accountId } = useAuth();
  const t = useTranslations("kanban");
  const tCommon = useTranslations("common");

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactId, setContactId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("contacts").select("*").order("name");
      if (cancelled) return;
      setContacts((data ?? []) as Contact[]);
      setContactId("");
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  const availableContacts = contacts.filter((c) => !existingContactIds.has(c.id));

  async function handleSave() {
    if (!contactId || !accountId) return;
    const firstStage = [...stages].sort((a, b) => a.position - b.position)[0];
    if (!firstStage) {
      toast.error(t("addLeadForm.noStagesConfigured"));
      return;
    }
    setSaving(true);

    const { data: created, error } = await supabase
      .from("contact_journey")
      .insert({ account_id: accountId, contact_id: contactId, stage_id: firstStage.id })
      .select("id")
      .single();

    if (error || !created) {
      toast.error(t("addLeadForm.addFailed"));
      setSaving(false);
      return;
    }

    await supabase.from("contact_journey_transitions").insert({
      contact_journey_id: created.id,
      account_id: accountId,
      from_stage_id: null,
      to_stage_id: firstStage.id,
    });

    setSaving(false);
    toast.success(t("addLeadForm.added"));
    onOpenChange(false);
    onCreated();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-popover border-border text-popover-foreground sm:max-w-sm w-full p-0"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border/50 p-4">
            <SheetTitle className="text-popover-foreground">{t("addLead")}</SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("addLeadForm.contactLabel")}</Label>
              <select
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">{t("addLeadForm.selectContactPlaceholder")}</option>
                {availableContacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.phone}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {t("addLeadForm.entersAtStage", { stage: stages[0]?.name ?? "—" })}
              </p>
            </div>
          </div>

          <div className="border-t border-border/50 bg-popover/80 p-4">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1 border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {tCommon("actions.cancel")}
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !contactId}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? t("addLeadForm.adding") : t("addLead")}
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
