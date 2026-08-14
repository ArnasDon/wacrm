'use client';

import { FlowItemRow } from './flow-item-row';
import type { FlowItem } from '@/lib/calculator/types';

interface FlowEditorProps {
  items: FlowItem[];
  balancerId: string | null;
  propertyValue: number;
  formatMoney: (value: number) => string;
  onToggleLock: (id: string) => void;
  onChangeValue: (id: string, value: number) => void;
  onChangeCount: (id: string, count: number) => void;
  onChangePercent: (id: string, percent: number) => void;
  onChangeLabel: (id: string, label: string) => void;
  onRemove: (id: string) => void;
  emptyStateLabel: string;
  installmentsCountLabel: string;
  lockLabel: string;
  unlockLabel: string;
  removeLabel: string;
}

export function FlowEditor({
  items,
  balancerId,
  propertyValue,
  formatMoney,
  onToggleLock,
  onChangeValue,
  onChangeCount,
  onChangePercent,
  onChangeLabel,
  onRemove,
  emptyStateLabel,
  installmentsCountLabel,
  lockLabel,
  unlockLabel,
  removeLabel,
}: FlowEditorProps) {
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
        {emptyStateLabel}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[26rem] flex-col gap-2">
        {items.map((item) => (
          <FlowItemRow
            key={item.id}
            item={item}
            isBalancer={item.id === balancerId}
            propertyValue={propertyValue}
            formatMoney={formatMoney}
            onToggleLock={() => onToggleLock(item.id)}
            onChangeValue={(value) => onChangeValue(item.id, value)}
            onChangeCount={(count) => onChangeCount(item.id, count)}
            onChangePercent={(percent) => onChangePercent(item.id, percent)}
            onChangeLabel={(label) => onChangeLabel(item.id, label)}
            onRemove={() => onRemove(item.id)}
            lockLabel={lockLabel}
            unlockLabel={unlockLabel}
            removeLabel={removeLabel}
            installmentsCountLabel={installmentsCountLabel}
          />
        ))}
      </div>
    </div>
  );
}
