"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { formatDistanceToNow } from "date-fns";
import { MessageSquare, Pencil, Tag as TagIcon, X as XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
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
import type { Conversation, Deal, PipelineStage } from "@/types";
import { DealForm } from "./deal-form";

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

  // FLIP: measure the gap between the clicked card and the panel's own
  // resting position/size, then hand that delta to the popup as CSS
  // custom properties its own open/close keyframes read (see the scoped
  // <style jsx> below). Applied from a ref *callback*, not a `useRef` +
  // `useLayoutEffect` pair — Base UI's Popup doesn't necessarily mount
  // into the DOM on the same render its `open` prop flips true, so a
  // layout effect keyed off `deal`/`originRect` can fire while the ref is
  // still null and never get a second chance. A callback ref instead
  // fires exactly when the node actually attaches, whichever render that
  // turns out to be. `lastAppliedDealRef` keeps it a one-shot per open —
  // React re-invokes an inline callback ref on every render (its identity
  // changes each time), and re-running this after the entrance animation
  // has already started would fight the animation over the same
  // properties.
  const popupRef = useRef<HTMLDivElement | null>(null);
  const lastAppliedDealRef = useRef<string | null>(null);

  function applyFlipVars(popup: HTMLDivElement) {
    if (!originRect) {
      popup.style.removeProperty("--flip-x");
      popup.style.removeProperty("--flip-y");
      popup.style.removeProperty("--flip-scale-x");
      popup.style.removeProperty("--flip-scale-y");
      return;
    }
    const finalRect = popup.getBoundingClientRect();
    if (finalRect.width === 0 || finalRect.height === 0) return;
    const dx =
      originRect.left + originRect.width / 2 - (finalRect.left + finalRect.width / 2);
    const dy =
      originRect.top + originRect.height / 2 - (finalRect.top + finalRect.height / 2);
    popup.style.setProperty("--flip-x", `${dx}px`);
    popup.style.setProperty("--flip-y", `${dy}px`);
    popup.style.setProperty("--flip-scale-x", String(originRect.width / finalRect.width));
    popup.style.setProperty("--flip-scale-y", String(originRect.height / finalRect.height));
  }

  if (!deal) return null;

  const contact = deal.contact;
  const displayName = contact?.name || contact?.phone || tCard("noContact");
  const initials = displayName.trim().charAt(0).toUpperCase() || "?";
  const tags = contact?.tags ?? [];

  return (
    <>
      <Dialog open={!!deal && !editOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogPortal>
          <DialogOverlay />
          {/* Custom Popup instead of the shared <DialogContent> — this is
              the one dialog in the app that needs a bespoke open/close
              motion (grows out of the clicked card instead of the
              default centered fade+zoom every other dialog uses), so it
              gets its own markup rather than fighting the shared
              component's default animation classes. Portal/Overlay/
              Title/Description/Footer are all still the same shared
              pieces as every other dialog. */}
          <DialogPrimitive.Popup
            ref={(node) => {
              popupRef.current = node;
              if (!node) {
                // Unmounting (closed, or hand-off to the edit form) —
                // clear so re-opening this same deal later re-applies
                // instead of being skipped as "already done".
                lastAppliedDealRef.current = null;
                return;
              }
              if (lastAppliedDealRef.current !== deal.id) {
                applyFlipVars(node);
                lastAppliedDealRef.current = deal.id;
              }
            }}
            data-slot="deal-detail-popup"
            className="deal-flip-popup fixed top-1/2 left-1/2 z-50 grid max-h-[85vh] w-full max-w-[calc(100%-2rem)] gap-4 overflow-y-auto rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none sm:max-w-md"
          >
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                // `z-10` — the content wrapper's own entrance animation
                // (`.deal-flip-content`, animating opacity) creates its
                // own stacking context, which — being later in DOM order
                // than this absolutely-positioned button — would
                // otherwise paint over it and swallow its clicks.
                className="absolute top-2 right-2 z-10"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
          {/* Content fades in slightly after the panel shape itself
              starts moving — "conteúdo surge progressivamente" without
              staggering every individual field. */}
          <div className="deal-flip-content grid gap-4">
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
          </div>
          </DialogPrimitive.Popup>
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

      <style jsx>{`
        /* :global() — styled-jsx's automatic scoping-class injection only
           rewrites simple JSX tags (<div>, <MyComponent>); it doesn't
           reach member-expression tags like <DialogPrimitive.Popup>, so
           an auto-scoped selector here would compile to a class the
           actual element never receives and silently never match.
           "deal-flip-*" is specific enough that going unscoped is safe. */
        /* Resting position — same centering the default DialogContent
           gets from its -translate-x-1/2/-translate-y-1/2 utilities,
           just written as one explicit \`transform\` here so the open/
           close keyframes below (which also animate \`transform\`) have
           a single, unambiguous property to interpolate. */
        :global(.deal-flip-popup) {
          transform: translate(-50%, -50%);
        }
        @media (prefers-reduced-motion: no-preference) {
          :global(.deal-flip-popup[data-open]) {
            animation: deal-flip-in 320ms cubic-bezier(0.16, 1, 0.3, 1) both;
          }
          :global(.deal-flip-popup[data-closed]) {
            animation: deal-flip-out 240ms cubic-bezier(0.4, 0, 1, 1) both;
          }
          :global(.deal-flip-content) {
            animation: deal-flip-content-in 200ms ease-out 90ms both;
          }
        }
        /* Falls back to var(...,0px)/var(...,1) — i.e. no motion beyond
           the opacity fade — on the rare open with no captured origin
           (e.g. keyboard activation landing before layout settles), so
           it never animates from garbage/unset values. */
        @keyframes deal-flip-in {
          from {
            transform: translate(-50%, -50%) translate(var(--flip-x, 0px), var(--flip-y, 0px))
              scale(var(--flip-scale-x, 1), var(--flip-scale-y, 1));
            opacity: 0.5;
          }
          to {
            transform: translate(-50%, -50%);
            opacity: 1;
          }
        }
        @keyframes deal-flip-out {
          from {
            transform: translate(-50%, -50%);
            opacity: 1;
          }
          to {
            transform: translate(-50%, -50%) translate(var(--flip-x, 0px), var(--flip-y, 0px))
              scale(var(--flip-scale-x, 1), var(--flip-scale-y, 1));
            opacity: 0.5;
          }
        }
        @keyframes deal-flip-content-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
      `}</style>
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
