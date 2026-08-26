"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Deal, PipelineStage } from "@/types";
import { Calendar, Check, X, MessageSquare, Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { createClient } from "@/lib/supabase/client";
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

export function DealCard({ deal, stage, onEdit, isOverlay }: DealCardProps) {
  const t = useTranslations("Pipelines.card");
  const router = useRouter();
  const [openingConversation, setOpeningConversation] = useState(false);
  const contactLabel = deal.contact?.name || deal.contact?.phone || t("noContact");
  const assigneeLabel = deal.assignee?.full_name || null;

  // deals.conversation_id is never actually populated by any write
  // path (deal-form.tsx only reads it for display, create_deal steps
  // don't set it either) — resolve the conversation from contact_id
  // at click time instead of trusting the column.
  async function handleOpenConversation(e: React.MouseEvent) {
    e.stopPropagation();
    if (!deal.contact_id || openingConversation) return;
    setOpeningConversation(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("conversations")
        .select("id")
        .eq("contact_id", deal.contact_id)
        .order("created_at", { ascending: true })
        .limit(1);
      if (!error && data && data.length > 0) {
        router.push(`/inbox?c=${data[0].id}`);
        return;
      }

      // No conversation exists yet (e.g. right after a conversations
      // reset) — find-or-create through the server route rather than
      // inserting from here directly, so the race-safe unique-index
      // handling (migration 036) and account/role checks live in one
      // place instead of being duplicated in every caller.
      const res = await fetch(`/api/contacts/${deal.contact_id}/conversation`, {
        method: "POST",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.id) {
        toast.error(t("noConversation"));
        return;
      }
      router.push(`/inbox?c=${json.id}`);
    } finally {
      setOpeningConversation(false);
    }
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        // `onClick` still fires after a non-drag tap because the PointerSensor
        // requires 5px movement before it counts as a drag.
        if (isOverlay) return;
        e.stopPropagation();
        onEdit(deal);
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
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {contactLabel}
        </span>
        {deal.contact_id && (
          <span
            role="button"
            tabIndex={0}
            aria-label={t("openConversation")}
            title={t("openConversation")}
            onClick={handleOpenConversation}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleOpenConversation(e as unknown as React.MouseEvent);
              }
            }}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/15 hover:text-primary"
          >
            {openingConversation ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <MessageSquare className="h-3.5 w-3.5" />
            )}
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm font-bold text-primary">
          {formatCurrency(deal.value, deal.currency)}
        </span>
        {deal.expected_close_date && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {formatDate(deal.expected_close_date)}
          </span>
        )}
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
