import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import type { ComponentType } from 'react';
import { cn } from '@/lib/utils';

interface MetricCardProps {
  title: string;
  /** Pre-formatted value for display (e.g. "42" or "$1,250"). */
  value: string;
  icon: ComponentType<{ className?: string }>;
  /**
   * Delta-mode secondary row: arrow + delta text. Omit when the metric
   * doesn't have a sensible comparison (e.g. total pipeline value).
   */
  delta?: {
    /** Positive / negative / zero drives arrow + color. */
    sign: number;
    /** Pre-formatted delta, e.g. "+3 vs yesterday". */
    label: string;
  };
  /** Used instead of `delta` when the metric has a static subtitle. */
  subtitle?: string;
}

export function MetricCard({
  title,
  value,
  icon: Icon,
  delta,
  subtitle,
}: MetricCardProps) {
  return (
    <div className="border-border bg-card rounded-xl border p-5">
      <div className="flex items-start justify-between">
        <p className="text-muted-foreground text-sm font-medium">{title}</p>
        <div className="bg-muted text-muted-foreground flex h-8 w-8 items-center justify-center rounded-lg">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="text-foreground mt-3 text-[28px] leading-none font-bold tabular-nums">
        {value}
      </p>
      {delta ? (
        <DeltaRow sign={delta.sign} label={delta.label} />
      ) : subtitle ? (
        <p className="text-muted-foreground mt-2 text-sm">{subtitle}</p>
      ) : null}
    </div>
  );
}

function DeltaRow({ sign, label }: { sign: number; label: string }) {
  const tone =
    sign > 0
      ? 'text-primary'
      : sign < 0
        ? 'text-red-400'
        : 'text-muted-foreground';
  const Arrow = sign > 0 ? ArrowUp : sign < 0 ? ArrowDown : Minus;
  return (
    <div className={cn('mt-2 flex items-center gap-1 text-sm', tone)}>
      <Arrow className="h-4 w-4" aria-hidden />
      <span className="tabular-nums">{label}</span>
    </div>
  );
}
