"use client";

import type { Deal, PipelineStage } from "@/types";
import { Calendar, Check, X, MessageCircle } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { useTranslations } from "next-intl";

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
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

function formatAppointment(dateStr: string) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month} às ${hours}:${minutes}`;
}

export function DealCard({ deal, stage, onEdit, isOverlay }: DealCardProps) {
  const t = useTranslations("Pipelines.card");
  const contactLabel = deal.contact?.name || deal.contact?.phone || t("noContact");
  const assigneeLabel = deal.assignee?.full_name || null;

  // Show yellow badge when the linked conversation has unread messages from the lead.
  // The unread_count resets to 0 automatically when the agent replies.
  const hasUnread =
    deal.conversation != null && (deal.conversation.unread_count ?? 0) > 0;

  return (
    <button
      type="button"
      onClick={(e) => {
        if (isOverlay) return;
        e.stopPropagation();
        onEdit(deal);
      }}
      className={`group relative w-full cursor-pointer rounded-xl border pl-4 pr-3 py-3 text-left shadow-sm transition-all ${
        hasUnread
          ? "border-yellow-400/60 bg-yellow-500/5 hover:border-yellow-400 hover:bg-yellow-500/10"
          : "border-border/50 bg-muted/70 hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:shadow-lg"
      } ${isOverlay ? "shadow-xl" : ""}`}
    >
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
      />

      <div className="flex items-start justify-between gap-2">
        <h4 className="flex-1 text-sm font-semibold leading-snug text-foreground break-words">
          {deal.title}
        </h4>
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
      </div>

      {/* Contact row */}
      <div className="mt-2 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
          {initials(deal.contact?.name, deal.contact?.phone)}
        </span>
        <span className="truncate text-xs text-muted-foreground">{contactLabel}</span>
      </div>

      {/* Unread message badge */}
      {hasUnread && (
        <div className="mt-2 flex flex-col gap-1 rounded-lg bg-yellow-500/15 p-2">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-yellow-400" />
            </span>
            <MessageCircle className="h-3.5 w-3.5 shrink-0 text-yellow-400" />
            <span className="text-[10px] font-semibold text-yellow-400">
              {t("newMessage")}
              {(deal.conversation!.unread_count ?? 0) > 1
                ? ` (${deal.conversation!.unread_count})`
                : ""}
            </span>
          </div>
          {deal.conversation?.last_message_text && (
            <p className="line-clamp-2 text-xs font-medium text-yellow-300/90 break-words">
              "{deal.conversation.last_message_text}"
            </p>
          )}
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between border-t border-border/40 pt-2">
        <span className="text-xs font-bold text-emerald-400 font-mono">
          {formatCurrency(deal.value ?? 0, deal.currency || "BRL")}
        </span>
        <div className="flex flex-col items-end gap-1">
          {deal.appointment_at && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-primary dark:text-primary-foreground/95 bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
              <Calendar className="h-3 w-3 text-primary" />
              {formatAppointment(deal.appointment_at)}
            </span>
          )}
          {deal.expected_close_date && !deal.appointment_at && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Calendar className="h-3 w-3" />
              {formatDate(deal.expected_close_date)}
            </span>
          )}
        </div>
      </div>

      {assigneeLabel && (
        <div className="mt-2 flex items-center justify-end">
          <span
            title={assigneeLabel}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary"
          >
            {initials(assigneeLabel)}
          </span>
        </div>
      )}
    </button>
  );
}
