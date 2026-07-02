"use client";

import type { ContactJourney, FunnelStage } from "@/types";
import { MessageCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { STALE_AFTER_MS } from "@/lib/journey/funnel-stages";

interface LeadCardProps {
  journey: ContactJourney;
  stage: FunnelStage | null;
  onOpen: (journey: ContactJourney) => void;
  isOverlay?: boolean;
}

function initials(name?: string, fallback?: string) {
  const source = (name || fallback || "?").trim();
  if (!source) return "?";
  return source.charAt(0).toUpperCase();
}

export function LeadCard({ journey, stage, onOpen, isOverlay }: LeadCardProps) {
  const contact = journey.contact;
  const contactLabel = contact?.name || contact?.phone || "Unknown contact";
  const enteredAt = new Date(journey.entered_stage_at);
  const isStale = new Date().getTime() - enteredAt.getTime() > STALE_AFTER_MS;
  const lastMessage = journey.conversation?.last_message_text;

  return (
    <button
      type="button"
      onClick={(e) => {
        if (isOverlay) return;
        e.stopPropagation();
        onOpen(journey);
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

      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
            {initials(contact?.name, contact?.phone)}
          </span>
          <h4 className="text-sm font-semibold leading-snug text-foreground break-words">
            {contactLabel}
          </h4>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
            isStale
              ? "bg-red-500/15 text-red-400"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {formatDistanceToNow(enteredAt, { addSuffix: true })}
        </span>
      </div>

      {lastMessage && (
        <div className="mt-2 flex items-start gap-1.5">
          <MessageCircle className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
          <p className="line-clamp-2 text-xs text-muted-foreground">{lastMessage}</p>
        </div>
      )}

      {contact?.phone && (
        <p className="mt-2 text-[11px] text-muted-foreground">{contact.phone}</p>
      )}
    </button>
  );
}
