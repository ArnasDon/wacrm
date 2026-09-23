'use client';

import type { Deal, PipelineStage } from '@/types';
import { Calendar, Check, X } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { useTranslations } from 'next-intl';

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  isOverlay?: boolean;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function initials(name?: string, fallback?: string) {
  const source = (name || fallback || '?').trim();
  if (!source) return '?';
  return source.charAt(0).toUpperCase();
}

export function DealCard({ deal, stage, onEdit, isOverlay }: DealCardProps) {
  const t = useTranslations('Pipelines.card');
  const contactLabel =
    deal.contact?.name || deal.contact?.phone || t('noContact');
  const assigneeLabel = deal.assignee?.full_name || null;

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
      className={`group border-border/50 bg-muted/70 relative w-full cursor-pointer rounded-xl border py-3 pr-3 pl-4 text-left shadow-sm transition-all ${
        isOverlay
          ? 'shadow-xl'
          : 'hover:border-border hover:bg-muted hover:-translate-y-0.5 hover:shadow-lg'
      }`}
    >
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute top-0 left-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? '#94a3b8' }}
      />

      <div className="flex items-start justify-between gap-2">
        <h4 className="text-foreground flex-1 text-sm leading-snug font-semibold break-words">
          {deal.title}
        </h4>
        {deal.status === 'won' && (
          <span className="bg-primary/15 text-primary inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold">
            <Check className="h-3 w-3" />
            {t('won')}
          </span>
        )}
        {deal.status === 'lost' && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
            <X className="h-3 w-3" />
            {t('lost')}
          </span>
        )}
      </div>

      {/* Contact row */}
      <div className="mt-2 flex items-center gap-2">
        <span className="bg-muted text-foreground flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold">
          {initials(deal.contact?.name, deal.contact?.phone)}
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {contactLabel}
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-primary text-sm font-bold">
          {formatCurrency(deal.value, deal.currency)}
        </span>
        {deal.expected_close_date && (
          <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
            <Calendar className="h-3 w-3" />
            {formatDate(deal.expected_close_date)}
          </span>
        )}
      </div>

      {assigneeLabel && (
        <div className="mt-2 flex items-center justify-end">
          <span
            title={assigneeLabel}
            className="bg-primary/15 text-primary flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold"
          >
            {initials(assigneeLabel)}
          </span>
        </div>
      )}
    </button>
  );
}
