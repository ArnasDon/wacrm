"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { formatDistanceToNow } from "date-fns";
import { ListChecks, MessageSquare, Pencil, Tag as TagIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ExpandingDialogContent } from "@/components/ui/expanding-dialog-content";
import type { Conversation, Deal, PipelineStage } from "@/types";
import { DealForm } from "./deal-form";
import { AddToActionCenterDialog } from "@/components/action-items/add-to-action-center-dialog";

interface DealDetailDrawerProps {
  /** Null hides the drawer — the parent owns "which deal", this
   *  component owns the read view + hand-off to the edit form. */
  deal: Deal | null;
  stage: PipelineStage | null;
  pipelineId: string;
  stages: PipelineStage[];
  /** The clicked card's own bounding box, captured by DealCard at the
   *  moment of the click — the FLIP animation's "first" state. Null/
   *  undefined (e.g. no origin captured) just falls back to the panel
   *  fading/growing in from its own center, still animated, no jump. */
  originRect?: DOMRect | null;
  onClose: () => void;
  /** Called after an edit actually saves, so the board can refetch. */
  onChanged: () => void;
}

export function DealDetailDrawer({
  deal,
  stage,
  pipelineId,
  stages,
  originRect,
  onClose,
  onChanged,
}: DealDetailDrawerProps) {
  const t = useTranslations("Pipelines.detail");
  const tCard = useTranslations("Pipelines.card");
  const locale = useLocale();

  const [editOpen, setEditOpen] = useState(false);
  const [actionCenterOpen, setActionCenterOpen] = useState(false);
  const [conversation, setConversation] = useState<Conversation | null>(null);

  // Same "most recent conversation for this contact" lookup DealForm
  // already does — prefer the deal's own conversation_id (populated for
  // leads auto-created from an inbound WhatsApp message) and fall back
  // to a contact lookup for deals that predate that link.
  useEffect(() => {
    if (!deal) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConversation(null);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      if (deal.conversation_id) {
        const { data } = await supabase
          .from("conversations")
          .select("*")
          .eq("id", deal.conversation_id)
          .maybeSingle();
        if (!cancelled) setConversation((data as Conversation) ?? null);
        return;
      }
      if (deal.contact_id) {
        const { data } = await supabase
          .from("conversations")
          .select("*")
          .eq("contact_id", deal.contact_id)
          .order("last_message_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!cancelled) setConversation((data as Conversation) ?? null);
        return;
      }
      setConversation(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [deal]);

  if (!deal) return null;

  const contact = deal.contact;
  const displayName = contact?.name || contact?.phone || tCard("noContact");
  const initials = displayName.trim().charAt(0).toUpperCase() || "?";
  const tags = contact?.tags ?? [];

  return (
    <>
      <Dialog
        open={!!deal && !editOpen}
        // `open` is computed from two sources (`deal` and `editOpen`),
        // so a false transition doesn't always mean "the user dismissed
        // this dialog" — clicking "Editar" also flips `open` to false
        // (via `!editOpen`) purely to hand off to the edit Sheet, not to
        // close the whole drawer. Without the `!editOpen` guard here,
        // that handoff was indistinguishable from a real dismiss and
        // called `onClose()`, which nulls out `deal` in the parent and
        // unmounts this entire component — including the `<DealForm>`
        // that was supposed to open — so "Editar" silently closed
        // everything instead of opening the edit form.
        onOpenChange={(open) => {
          if (!open && !editOpen) onClose();
        }}
      >
        <DialogPortal>
          <DialogOverlay />
          {/* Shared "grows out of the clicked card" popup shell — see
              ExpandingDialogContent / useFlipTransition. Portal/Overlay/
              Title/Description/Footer are still the same shared pieces
              as every other dialog. */}
          <ExpandingDialogContent originRect={originRect}>
          <DialogHeader>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-semibold text-foreground">
                {contact?.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={contact.avatar_url}
                    alt={displayName}
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  initials
                )}
              </span>
              <div className="min-w-0">
                <DialogTitle className="truncate">{displayName}</DialogTitle>
                {contact?.phone && (
                  <DialogDescription>{contact.phone}</DialogDescription>
                )}
              </div>
            </div>
          </DialogHeader>

          {/* Tags — same pill style as the contact sidebar in the Inbox */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <TagIcon className="h-3 w-3" />
              {t("tags")}
            </div>
            <div className="mt-2 flex flex-wrap gap-1 px-1">
              {tags.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("noTags")}</p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
                  >
                    {tag.name}
                  </span>
                ))
              )}
            </div>
          </div>

          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs font-medium text-muted-foreground">{t("stage")}</dt>
              <dd className="mt-1">
                {stage ? (
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{ backgroundColor: `${stage.color}20`, color: stage.color }}
                  >
                    {stage.name}
                  </span>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <DetailRow
              label={t("createdAt")}
              value={formatDateTimeLabel(deal.created_at, locale)}
            />
            <DetailRow
              label={t("notes")}
              value={deal.notes || t("noNotes")}
              multiline
            />
          </dl>

          {/* Lightweight "history" — the real message-by-message history
              already lives in the Inbox; this surfaces the latest
              interaction and links straight into the full thread. */}
          <div>
            <dt className="text-xs font-medium text-muted-foreground">
              {t("lastInteraction")}
            </dt>
            <dd className="mt-1 text-sm text-foreground">
              {conversation?.last_message_text ? (
                <>
                  <p className="line-clamp-2">{conversation.last_message_text}</p>
                  {conversation.last_message_at && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(conversation.last_message_at), {
                        addSuffix: true,
                      })}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">{t("noHistory")}</p>
              )}
            </dd>
          </div>

          <DialogFooter className="flex-wrap items-center gap-2 sm:flex-row sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {conversation && (
                // `conversation` only resolves once its async Supabase fetch
                // (above) finishes, which lands independently of — and often
                // slightly after — the FLIP entrance animation. Without this,
                // the link's mount is a hard DOM swap from the empty `<span>`
                // placeholder straight to full opacity, which reads as a
                // stutter right as the rest of the open sequence is settling.
                // `animate-in fade-in` just gives *this* element its own
                // 200ms entrance regardless of when it actually mounts, so a
                // late resolve looks like an intentional soft reveal instead
                // of a pop-in — the FLIP animation's own duration/curve/
                // transform are untouched. Rendered through the shared
                // Button component (not a hand-styled <Link>) so its
                // height/padding/radius are byte-identical to the other
                // two footer buttons instead of approximated by hand.
                <Button
                  variant="outline"
                  className="animate-in fade-in duration-200"
                  render={<Link href={`/inbox?c=${conversation.id}`} />}
                >
                  <MessageSquare className="h-4 w-4" />
                  {t("openConversation")}
                </Button>
              )}
              {deal.contact_id && (
                <Button variant="outline" onClick={() => setActionCenterOpen(true)}>
                  <ListChecks className="h-4 w-4" />
                  {t("addToActionCenter")}
                </Button>
              )}
            </div>
            <Button onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" />
              {t("edit")}
            </Button>
          </DialogFooter>
          </ExpandingDialogContent>
        </DialogPortal>
      </Dialog>

      <DealForm
        open={editOpen}
        onOpenChange={setEditOpen}
        deal={deal}
        pipelineId={pipelineId}
        stages={stages}
        onSaved={() => {
          onChanged();
          onClose();
        }}
      />

      {deal.contact_id && (
        <AddToActionCenterDialog
          open={actionCenterOpen}
          onOpenChange={setActionCenterOpen}
          contactId={deal.contact_id}
          contactName={displayName}
          conversationId={conversation?.id ?? deal.conversation_id ?? null}
          onSaved={onChanged}
        />
      )}
    </>
  );
}

function DetailRow({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-foreground ${multiline ? "whitespace-pre-wrap" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function formatDateTimeLabel(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
}
