"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { formatDistanceToNow } from "date-fns";
import { MessageSquare, Pencil, Tag as TagIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Conversation, Deal, PipelineStage } from "@/types";
import { DealForm } from "./deal-form";

interface DealDetailDrawerProps {
  /** Null hides the drawer — the parent owns "which deal", this
   *  component owns the read view + hand-off to the edit form. */
  deal: Deal | null;
  stage: PipelineStage | null;
  pipelineId: string;
  stages: PipelineStage[];
  onClose: () => void;
  /** Called after an edit actually saves, so the board can refetch. */
  onChanged: () => void;
}

export function DealDetailDrawer({
  deal,
  stage,
  pipelineId,
  stages,
  onClose,
  onChanged,
}: DealDetailDrawerProps) {
  const t = useTranslations("Pipelines.detail");
  const tCard = useTranslations("Pipelines.card");
  const locale = useLocale();

  const [editOpen, setEditOpen] = useState(false);
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
      <Dialog open={!!deal && !editOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
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

          <DialogFooter className="gap-2 sm:justify-between">
            {conversation ? (
              <Link
                href={`/inbox?c=${conversation.id}`}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground hover:bg-muted"
              >
                <MessageSquare className="h-4 w-4" />
                {t("openConversation")}
              </Link>
            ) : (
              <span />
            )}
            <Button onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" />
              {t("edit")}
            </Button>
          </DialogFooter>
        </DialogContent>
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
