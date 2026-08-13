"use client";

import type { Deal, PipelineStage } from "@/types";
import { Calendar, Check, X, MoreVertical, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { RESPONDER_COLOR_CLASS } from "@/lib/responder-color";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  /** `originRect` (the clicked card's own bounding box) lets the deal
   *  detail panel open with a FLIP animation that grows out of the card
   *  instead of just fading/zooming in centered. */
  onEdit: (deal: Deal, originRect?: DOMRect) => void;
  /** Opens the shared delete-lead confirmation — omitted on the drag
   *  overlay copy, which is a static preview with no menu. */
  onRequestDelete?: (deal: Deal) => void;
  isOverlay?: boolean;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function initials(name?: string, fallback?: string) {
  const source = (name || fallback || "?").trim();
  if (!source) return "?";
  return source.charAt(0).toUpperCase();
}

export function DealCard({ deal, stage, onEdit, onRequestDelete, isOverlay }: DealCardProps) {
  const t = useTranslations("Pipelines.card");
  const tLeads = useTranslations("Leads.deleteDialog");
  const contact = deal.contact;
  const displayName = contact?.name || contact?.phone || t("noContact");
  // Only show a separate phone line when it isn't already doing double
  // duty as the name above (contactless leads fall back to phone there).
  const showPhoneLine = !!contact?.name && !!contact?.phone;
  const assigneeLabel = deal.assignee?.full_name || null;
  const tags = contact?.tags ?? [];

  function handleActivate(originRect?: DOMRect) {
    if (isOverlay) return;
    onEdit(deal, originRect);
  }

  return (
    // A native <button> can't validly contain the dropdown's own
    // interactive elements, so this is a div acting as a button
    // (role + tabIndex + keydown) — same reasoning applies to
    // ConversationItem in the Inbox for the same delete-lead menu.
    <div
      role="button"
      tabIndex={isOverlay ? -1 : 0}
      onClick={(e) => {
        // `onClick` still fires after a non-drag tap because the PointerSensor
        // requires 5px movement before it counts as a drag.
        e.stopPropagation();
        handleActivate(e.currentTarget.getBoundingClientRect());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleActivate(e.currentTarget.getBoundingClientRect());
        }
      }}
      className={`group relative w-full cursor-pointer rounded-xl border border-border/50 bg-muted/70 pl-4 pr-3 py-3 text-left shadow-sm transition-all ${
        isOverlay
          ? "shadow-xl"
          : "hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:shadow-lg"
      }`}
    >
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
      />

      {/* Contact row — photo, name, phone */}
      <div className="flex items-start gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-foreground">
          {contact?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={contact.avatar_url}
              alt={displayName}
              className="h-8 w-8 rounded-full object-cover"
            />
          ) : (
            initials(contact?.name, contact?.phone)
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-semibold leading-snug text-foreground">
            {displayName}
          </h4>
          {showPhoneLine && (
            <p className="truncate text-xs text-muted-foreground">{contact.phone}</p>
          )}
          {/* Last-internal-responder indicator — no text/icon, color only.
              Same source as the Inbox (colorForConversation), keyed by
              conversation_id, so a lead's card matches in both places. */}
          <span
            aria-hidden
            className={cn(
              "mt-1.5 block h-1 w-8 rounded-full",
              RESPONDER_COLOR_CLASS[deal.responder_color ?? "gray"],
            )}
          />
        </div>
        {deal.status === "won" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
            <Check className="h-3 w-3" />
            {t("won")}
          </span>
        )}
        {deal.status === "lost" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
            <X className="h-3 w-3" />
            {t("lost")}
          </span>
        )}
        {!isOverlay && onRequestDelete && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground"
                  onClick={(e) => e.stopPropagation()}
                  aria-label={tLeads("menuLabel")}
                />
              }
            >
              <MoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border-border bg-popover">
              <DropdownMenuItem
                variant="destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onRequestDelete(deal);
                }}
              >
                <Trash2 className="h-4 w-4" />
                {tLeads("menuLabel")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Tags — same pill style as the contact sidebar in the Inbox */}
      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span
              key={tag.id}
              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}

      {(deal.expected_close_date || assigneeLabel) && (
        <div className="mt-2 flex items-center justify-between">
          {deal.expected_close_date ? (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Calendar className="h-3 w-3" />
              {formatDate(deal.expected_close_date)}
            </span>
          ) : (
            <span />
          )}
          {assigneeLabel && (
            <span
              title={assigneeLabel}
              className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary"
            >
              {initials(assigneeLabel)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
