"use client";

import type { ReactNode } from "react";
import type { Deal, PipelineStage } from "@/types";
import { useRouter } from "next/navigation";
import { Calendar, Check, X, Mail, MessageSquare } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { formatRelative } from "@/lib/automations/trigger-meta";
import { useTranslations } from "next-intl";

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  isOverlay?: boolean;
  /** Chips extra (p. ej. 🔥⏳ de la cola) renderizados junto a won/lost. */
  rightBadges?: ReactNode;
  /** Slot para acciones de la cola (Llamar/WhatsApp/Contestó). */
  footer?: ReactNode;
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

export function DealCard({
  deal,
  stage,
  onEdit,
  isOverlay,
  rightBadges,
  footer,
}: DealCardProps) {
  const t = useTranslations("Pipelines.card");
  const router = useRouter();
  const contactLabel = deal.contact?.name || deal.contact?.phone || t("noContact");
  const assigneeLabel = deal.assignee?.full_name || null;

  // Última interacción (DAD §7.4): conversations.last_message_at +
  // last_message_text — info para el SDR, nunca score numérico.
  const lastTouch = deal.conversation?.last_message_at
    ? formatRelative(deal.conversation.last_message_at)
    : null;
  const lastText = deal.conversation?.last_message_text;
  const email = deal.contact?.email;
  const phone = deal.contact?.phone;
  const inboxHref = deal.conversation_id ? `/inbox?c=${deal.conversation_id}` : `/inbox`;

  return (
    // La raíz es un <div>, no un <button>: la tarjeta contiene enlaces de
    // correo y teléfono, y anidar elementos interactivos dentro de un <button>
    // es marcado inválido — React lo avisaba como error de hidratación y, en
    // la práctica, el botón exterior se tragaba los clics de los interiores.
    //
    // La acción de editar pasa a un botón superpuesto que cubre la tarjeta
    // (patrón "stretched link"): sigue siendo un objetivo grande y accesible
    // con teclado, pero deja de envolver a los demás.
    <div
      className={`group relative w-full rounded-xl border border-border/50 bg-muted/70 pl-4 pr-3 py-3 text-left shadow-sm transition-all ${
        isOverlay
          ? "shadow-xl"
          : "hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:shadow-lg"
      }`}
    >
      {!isOverlay && (
        <button
          type="button"
          onClick={(e) => {
            // `onClick` still fires after a non-drag tap because the
            // PointerSensor requires 5px movement before it counts as a drag.
            e.stopPropagation();
            onEdit(deal);
          }}
          aria-label={deal.title}
          className="absolute inset-0 z-0 cursor-pointer rounded-xl"
        />
      )}
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
        <span className="flex shrink-0 items-center gap-1">
          {rightBadges}
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
        </span>
      </div>

      {/* Contact row */}
      <div className="mt-2 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
          {initials(deal.contact?.name, deal.contact?.phone)}
        </span>
        <span className="truncate text-xs text-muted-foreground">{contactLabel}</span>
      </div>

      {/* Email + teléfono (info de contacto, no score) */}
      {(email || phone) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {email && (
            <a
              href={`mailto:${email}`}
              onClick={(e) => e.stopPropagation()}
              className="relative z-10 flex max-w-[9rem] items-center gap-1 truncate hover:text-foreground"
            >
              <Mail className="h-3 w-3 shrink-0" />
              <span className="truncate">{email}</span>
            </a>
          )}
          {phone && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                router.push(inboxHref);
              }}
              className="relative z-10 flex items-center gap-1 hover:text-foreground"
            >
              <MessageSquare className="h-3 w-3 shrink-0" />
              {phone}
            </button>
          )}
        </div>
      )}

      {/* Última interacción */}
      {lastTouch && (
        <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
          {t("lastTouch")}: {lastText ? lastText : lastTouch}
        </p>
      )}

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

      {footer}
    </div>
  );
}
