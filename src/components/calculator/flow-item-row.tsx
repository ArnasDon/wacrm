'use client';

import { Info, Lock, Unlock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { amountOf, percentOf } from '@/lib/calculator/engine';
import { formatPercentNumber } from '@/lib/calculator/money';
import { MoneyInput } from './money-input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { FlowItem } from '@/lib/calculator/types';

interface FlowItemRowProps {
  item: FlowItem;
  /** True when this is the item the engine is currently auto-balancing —
   *  its value is computed, not typed, so its %/valor render read-only. */
  isBalancer: boolean;
  propertyValue: number;
  formatMoney: (value: number) => string;
  onToggleLock: () => void;
  onChangeValue: (value: number) => void;
  onChangeCount: (count: number) => void;
  onChangePercent: (percent: number) => void;
  onChangeLabel: (label: string) => void;
  lockLabel: string;
  unlockLabel: string;
  installmentsCountLabel: string;
  totalAmountLabel: string;
}

/** Below this, the Chaves etapa's per-unit value renders in red — a
 *  pure visual nudge (spec §11), independent of the 100% validation
 *  banner. Never blocks editing, saving, or the engine's own math. */
const CHAVES_MIN_PERCENT = 40;

/** Fixed column widths shared by EVERY row, regardless of item kind or
 *  label length — this is what keeps the percent/quantity/value boxes
 *  in perfectly aligned vertical columns. Quantity still reserves its
 *  column for single-kind items (empty "—"), so a row without it
 *  never shifts the value/info columns leftward. */
const GRID_COLUMNS =
  'grid grid-cols-[2rem_7.5rem_4.5rem_3.25rem_1fr_1.75rem] items-center gap-x-2 sm:grid-cols-[2rem_9rem_4.5rem_3.25rem_1fr_1.75rem]';

export function FlowItemRow({
  item,
  isBalancer,
  propertyValue,
  formatMoney,
  onToggleLock,
  onChangeValue,
  onChangeCount,
  onChangePercent,
  onChangeLabel,
  lockLabel,
  unlockLabel,
  installmentsCountLabel,
  totalAmountLabel,
}: FlowItemRowProps) {
  const fieldsDisabled = item.locked || isBalancer;
  const livePercent = percentOf(item, propertyValue);
  const isChaves = item.label.trim().toLowerCase() === 'chaves';
  const chavesWarning = isChaves && livePercent < CHAVES_MIN_PERCENT - 0.05;

  return (
    <div className={cn(GRID_COLUMNS, 'flow-item-row rounded-lg border border-border bg-card px-3 py-2.5')}>
      <button
        type="button"
        onClick={onToggleLock}
        aria-label={item.locked ? unlockLabel : lockLabel}
        aria-pressed={item.locked}
        className={cn(
          'flex size-8 items-center justify-center rounded-lg border transition-colors',
          item.locked
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        {item.locked ? <Lock className="size-4" /> : <Unlock className="size-4" />}
      </button>

      <input
        value={item.label}
        onChange={(e) => onChangeLabel(e.target.value)}
        disabled={item.locked}
        className="min-w-0 border-0 bg-transparent p-0 text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />

      <div className="flex items-center gap-1">
        {fieldsDisabled ? (
          <span className="w-full text-center text-sm tabular-nums text-muted-foreground">
            {formatPercentNumber(livePercent)}%
          </span>
        ) : (
          <>
            <input
              type="number"
              min={0}
              max={100}
              step="1"
              value={item.percent ?? ''}
              placeholder={formatPercentNumber(livePercent)}
              onChange={(e) => onChangePercent(Math.max(0, Number(e.target.value) || 0))}
              className="h-8 w-full min-w-0 rounded-md border border-primary/40 bg-transparent px-1 text-center text-sm tabular-nums text-foreground outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20"
            />
            <span className="shrink-0 text-sm text-muted-foreground">%</span>
          </>
        )}
      </div>

      {item.kind === 'installments' ? (
        <input
          type="number"
          min={1}
          value={item.count}
          disabled={item.locked}
          aria-label={installmentsCountLabel}
          onChange={(e) => onChangeCount(Math.max(1, Number(e.target.value) || 1))}
          className="h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-1.5 text-center text-sm tabular-nums text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        />
      ) : (
        <span className="text-center text-sm text-muted-foreground/50 select-none" aria-hidden>
          —
        </span>
      )}

      <div className="flex min-w-0 items-center justify-end gap-1">
        {fieldsDisabled ? (
          <span
            className={cn(
              'truncate text-right text-sm font-medium tabular-nums',
              chavesWarning ? 'text-destructive' : 'text-foreground',
            )}
          >
            {formatMoney(item.value)}
          </span>
        ) : (
          <>
            <span className="shrink-0 text-sm text-muted-foreground select-none">R$</span>
            <MoneyInput
              value={item.value}
              onChange={onChangeValue}
              className={cn(
                'h-8 min-w-0 flex-1 text-right text-sm font-medium',
                chavesWarning ? 'text-destructive' : 'text-foreground',
              )}
            />
          </>
        )}
      </div>

      <Tooltip>
        <TooltipTrigger
          type="button"
          aria-label={totalAmountLabel}
          className="flex size-7 items-center justify-center justify-self-end rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Info className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent>{formatMoney(amountOf(item))}</TooltipContent>
      </Tooltip>
    </div>
  );
}
