'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FlowItemRow } from './flow-item-row';
import type { FlowItem, FlowItemKind } from '@/lib/calculator/types';

interface FlowEditorProps {
  items: FlowItem[];
  balancerId: string | null;
  propertyValue: number;
  formatMoney: (value: number) => string;
  onToggleLock: (id: string) => void;
  onChangeCount: (id: string, count: number) => void;
  onChangePercent: (id: string, percent: number) => void;
  onChangeLabel: (id: string, label: string) => void;
  onRemove: (id: string) => void;
  onAdd: (kind: FlowItemKind, label: string) => void;
  emptyStateLabel: string;
  addLabel: string;
  labelPlaceholder: string;
  singleKindLabel: string;
  installmentsKindLabel: string;
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
  onChangeCount,
  onChangePercent,
  onChangeLabel,
  onRemove,
  onAdd,
  emptyStateLabel,
  addLabel,
  labelPlaceholder,
  singleKindLabel,
  installmentsKindLabel,
  installmentsCountLabel,
  lockLabel,
  unlockLabel,
  removeLabel,
}: FlowEditorProps) {
  const [newLabel, setNewLabel] = useState('');
  const [newKind, setNewKind] = useState<FlowItemKind>('single');

  const handleAdd = () => {
    const label = newLabel.trim();
    if (!label) return;
    onAdd(newKind, label);
    setNewLabel('');
    setNewKind('single');
  };

  return (
    <div className="flex flex-col gap-2">
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          {emptyStateLabel}
        </p>
      ) : (
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
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2">
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
          }}
          placeholder={labelPlaceholder}
          className="h-8 min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <div className="flex overflow-hidden rounded-lg border border-input">
          {(['single', 'installments'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setNewKind(kind)}
              className={cn(
                'px-2.5 py-1 text-xs font-medium transition-colors',
                newKind === kind
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {kind === 'single' ? singleKindLabel : installmentsKindLabel}
            </button>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
          <Plus className="size-3.5" />
          {addLabel}
        </Button>
      </div>
    </div>
  );
}
