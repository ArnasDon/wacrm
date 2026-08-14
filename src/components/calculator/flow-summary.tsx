'use client';

import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { FlowItem } from '@/lib/calculator/types';

interface FlowSummaryProps {
  title: string;
  propertyValueLabel: string;
  totalLabel: string;
  propertyValue: number;
  total: number;
  items: FlowItem[];
  formatMoney: (value: number) => string;
  copyLabel: string;
  onCopy: () => void;
  installmentsOfLabel: string;
}

export function FlowSummary({
  title,
  propertyValueLabel,
  totalLabel,
  propertyValue,
  total,
  items,
  formatMoney,
  copyLabel,
  onCopy,
  installmentsOfLabel,
}: FlowSummaryProps) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      {title && (
        <h3 className="font-heading text-sm font-semibold tracking-wide text-foreground uppercase">
          {title}
        </h3>
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{propertyValueLabel}</span>
        <span className="text-sm font-medium tabular-nums text-foreground">
          {formatMoney(propertyValue)}
        </span>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-3">
        {items.map((item) => (
          <div key={item.id} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm text-muted-foreground">{item.label}</span>
            <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">
              {item.kind === 'installments'
                ? `${item.count} ${installmentsOfLabel} ${formatMoney(item.value)}`
                : formatMoney(item.value)}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-3">
        <span className="text-sm font-semibold text-foreground">{totalLabel}</span>
        <span className="text-lg font-semibold tabular-nums text-foreground">
          {formatMoney(total)}
        </span>
      </div>

      <Button type="button" variant="outline" onClick={onCopy} className="w-full">
        <Copy className="size-4" />
        {copyLabel}
      </Button>
    </div>
  );
}
