"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type {
  Contact,
  Conversation,
  Deal,
  PipelineStage,
  Profile,
} from "@/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useFollowupGate } from "@/hooks/use-followup-gate";
import { FollowupRequirementDialog } from "@/components/action-items/followup-requirement-dialog";

interface DealFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: Deal | null;
  pipelineId: string;
  stages: PipelineStage[];
  defaultStageId?: string;
  onSaved: () => void;
}

export function DealForm({
  open,
  onOpenChange,
  deal,
  pipelineId,
  stages,
  defaultStageId,
  onSaved,
}: DealFormProps) {
  const t = useTranslations("Pipelines.form");
  const supabase = createClient();
  const { accountId } = useAuth();
  const followupGate = useFollowupGate();

  const [title, setTitle] = useState("");
  const [contactId, setContactId] = useState("");
  const [stageId, setStageId] = useState("");
  const [notes, setNotes] = useState("");

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [linkedConversation, setLinkedConversation] =
    useState<Conversation | null>(null);

  const [saving, setSaving] = useState(false);

  // "Atribuído a" is never picked manually — it mirrors the same
  // first-responder ownership the Pipeline card's colored bar and the
  // Inbox attendant filter already read (conversations.assigned_agent_id,
  // set once by send-message.ts to whichever agent replies first and
  // never overwritten by a later reply). No parallel assignment logic.
  const assignedProfile =
    profiles.find((p) => p.user_id === linkedConversation?.assigned_agent_id) ??
    null;

  // Reset the form fields every time the sheet opens or its input
  // props change. This is a legitimate prop-driven sync; the rule is
  // over-cautious here, hence the block-level disable.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    if (deal) {
      setTitle(deal.title);
      // contact_id is nullable when the contact has been deleted
      // (migration 004: ON DELETE SET NULL). "" means "no selection".
      setContactId(deal.contact_id ?? "");
      setStageId(deal.stage_id);
      setNotes(deal.notes ?? "");
    } else {
      setTitle("");
      setContactId("");
      setStageId(defaultStageId || stages[0]?.id || "");
      setNotes("");
    }
  }, [open, deal, defaultStageId, stages]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Load supporting data once the sheet is open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [c, p] = await Promise.all([
        supabase.from("contacts").select("*").order("name"),
        supabase.from("profiles").select("*").order("full_name"),
      ]);
      if (cancelled) return;
      setContacts((c.data ?? []) as Contact[]);
      setProfiles((p.data ?? []) as Profile[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  // Fetch the linked conversation — same "prefer the deal's own
  // conversation_id, fall back to the contact's newest conversation"
  // lookup deal-detail-drawer.tsx already uses, so "Atribuído a" (below)
  // resolves against the same conversation the rest of the app treats
  // as this deal's thread. Clearing on no-selection is sync with prop
  // state; the populated case runs setLinkedConversation inside the
  // async fetch callback.
  useEffect(() => {
    if (!open || (!deal?.conversation_id && !contactId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLinkedConversation(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = deal?.conversation_id
        ? await supabase
            .from("conversations")
            .select("*")
            .eq("id", deal.conversation_id)
            .maybeSingle()
        : await supabase
            .from("conversations")
            .select("*")
            .eq("contact_id", contactId)
            .order("last_message_at", { ascending: false })
            .limit(1)
            .maybeSingle();
      if (cancelled) return;
      setLinkedConversation((data as Conversation | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, deal?.conversation_id, contactId, supabase]);

  async function doSave() {
    setSaving(true);

    const payload = {
      title: title.trim(),
      contact_id: contactId,
      pipeline_id: pipelineId,
      stage_id: stageId,
      assigned_to: assignedProfile?.id ?? null,
      notes: notes.trim() || null,
    };

    if (deal) {
      const { error } = await supabase
        .from("deals")
        .update(payload)
        .eq("id", deal.id);
      if (error) {
        toast.error(t("toastFailedSave"));
        setSaving(false);
        return;
      }
    } else {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        toast.error(t("toastNotSignedIn"));
        setSaving(false);
        return;
      }
      if (!accountId) {
        toast.error(t("toastNotLinked"));
        setSaving(false);
        return;
      }
      const { error } = await supabase
        .from("deals")
        .insert({ ...payload, user_id: user.id, account_id: accountId, status: "open" });
      if (error) {
        toast.error(t("toastFailedCreate"));
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    toast.success(deal ? t("toastUpdated") : t("toastCreated"));
    onOpenChange(false);
    onSaved();
  }

  // AGENTS task: saving this form into "Follow-up" (the Etapa select)
  // requires motivo + prazo, same global gate every other entry point
  // uses. Only gated for an existing deal being edited — "creating a
  // new deal" through this form isn't reachable from the current UI
  // (deals are auto-created from the first inbound WhatsApp message;
  // see pipelines/page.tsx), so there's no "current stage" to compare
  // against there. `guardMove` itself is a no-op when the stage didn't
  // actually change or isn't Follow-up, so this never adds a prompt to
  // an ordinary save.
  async function handleSave() {
    if (!title.trim() || !contactId || !stageId) {
      toast.error(t("toastRequired"));
      return;
    }
    if (deal) {
      followupGate.guardMove({ deal, stages, targetStageId: stageId, performMove: doSave });
      return;
    }
    await doSave();
  }

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-popover border-border text-popover-foreground sm:max-w-lg w-full p-0"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border/50 p-4">
            <SheetTitle className="text-popover-foreground">
              {deal ? t("editDeal") : t("newDeal")}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("title")}</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("titlePlaceholder")}
                className="border-border bg-muted text-foreground"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("contact")}</Label>
              <select
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">{t("selectContact")}</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.phone}
                  </option>
                ))}
              </select>

              {linkedConversation && (
                <Link
                  href="/inbox"
                  className="mt-1 inline-flex items-center gap-1.5 self-start rounded-md bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20"
                >
                  <MessageSquare className="h-3 w-3" />
                  {t("linkToConversation")}
                </Link>
              )}
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("stage")}</Label>
              <select
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                disabled={!!deal?.archived_at}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {/* Archived leads are view-only for stage movement — the
                  card intentionally has no way to change etapa while off
                  the active board (AGENTS spec: "sem os botões de
                  movimentação de etapa"). Restore it from the Pipeline
                  card's "⋮" menu to unlock this again. */}
              {deal?.archived_at && (
                <p className="text-xs text-muted-foreground">{t("stageLockedArchived")}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("assignedTo")}</Label>
              {/* Read-only — set automatically from whichever agent
                  replied first on this lead's conversation (see
                  assignedProfile above), never picked by hand. */}
              <div className="flex h-9 w-full items-center rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground">
                {assignedProfile?.full_name || assignedProfile?.email || t("unassigned")}
              </div>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("notes")}</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("notesPlaceholder")}
                className="min-h-[100px] border-border bg-muted text-foreground"
              />
            </div>
          </div>

          <div className="border-t border-border/50 bg-popover/80 p-4">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1 border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !title.trim() || !contactId || !stageId}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? t("saving") : deal ? t("saveChanges") : t("createDeal")}
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>

    {/* Global "moving into Follow-up requires motivo+prazo" gate —
        catches this form's own Etapa select. */}
    <FollowupRequirementDialog {...followupGate} />
    </>
  );
}
