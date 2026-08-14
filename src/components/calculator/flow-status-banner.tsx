import { Check, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPercentNumber } from '@/lib/calculator/money';
import type { FlowStatus } from '@/lib/calculator/types';

interface FlowStatusBannerProps {
  status: FlowStatus;
  /** Always positive — the caller decides which label it pairs with. */
  differenceAbs: number;
  /** Always positive — |difference| expressed as a % of propertyValue. */
  percentGapAbs: number;
  formatMoney: (value: number) => string;
  closedLabel: string;
  incompleteLabel: string;
  excessLabel: string;
  missingPercentPrefix: string;
  missingPercentSuffix: string;
  missingAmountPrefix: string;
  excessOverPrefix: string;
  excessAmountPrefix: string;
}

const TONE_CLASSES: Record<FlowStatus, string> = {
  closed: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400',
  incomplete: 'border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400',
  excess: 'border-destructive/30 bg-destructive/5 text-destructive',
};

export function FlowStatusBanner({
  status,
  differenceAbs,
  percentGapAbs,
  formatMoney,
  closedLabel,
  incompleteLabel,
  excessLabel,
  missingPercentPrefix,
  missingPercentSuffix,
  missingAmountPrefix,
  excessOverPrefix,
  excessAmountPrefix,
}: FlowStatusBannerProps) {
  const percentText = `${formatPercentNumber(percentGapAbs)}%`;

  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm font-medium',
        TONE_CLASSES[status],
      )}
    >
      {status === 'closed' ? (
        <Check className="mt-0.5 size-4 shrink-0" />
      ) : (
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      )}
      {status === 'closed' && <span>{closedLabel}</span>}
      {status === 'incomplete' && (
        <div className="flex flex-col gap-0.5">
          <span>
            {incompleteLabel} — {missingPercentPrefix} {percentText} {missingPercentSuffix}.
          </span>
          <span className="font-normal opacity-90">
            {missingAmountPrefix} {formatMoney(differenceAbs)}.
          </span>
        </div>
      )}
      {status === 'excess' && (
        <div className="flex flex-col gap-0.5">
          <span>
            {excessLabel} — {excessOverPrefix} {percentText}.
          </span>
          <span className="font-normal opacity-90">
            {excessAmountPrefix}: {formatMoney(differenceAbs)}.
          </span>
        </div>
      )}
    </div>
  );
}
