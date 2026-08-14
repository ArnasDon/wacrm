'use client';

import { useState } from 'react';
import { Lock, Plus, Unlock, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { FlowComponentTemplate, FlowItemKind } from '@/lib/calculator/types';

interface ComponentTemplateEditorProps {
  components: FlowComponentTemplate[];
  onChange: (components: FlowComponentTemplate[]) => void;
  addLabel: string;
  labelPlaceholder: string;
  singleKindLabel: string;
  installmentsKindLabel: string;
  defaultLockedLabel: string;
  defaultCountLabel: string;
  defaultPercentLabel: string;
  emptyStateLabel: string;
  removeLabel: string;
}

/** Edits an empreendimento's reusable flow SHAPE (used by the project
 *  manager dialog) — a lighter cousin of FlowEditor/FlowItemRow since
 *  templates carry no amounts, only structure + starting defaults. */
export function ComponentTemplateEditor({
  components,
  onChange,
  addLabel,
  labelPlaceholder,
  singleKindLabel,
  installmentsKindLabel,
  defaultLockedLabel,
  defaultCountLabel,
  defaultPercentLabel,
  emptyStateLabel,
  removeLabel,
}: ComponentTemplateEditorProps) {
  const [newLabel, setNewLabel] = useState('');
  const [newKind, setNewKind] = useState<FlowItemKind>('single');

  const update = (id: string, patch: Partial<FlowComponentTemplate>) => {
    onChange(components.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const remove = (id: string) => {
    onChange(components.filter((c) => c.id !== id));
  };

  const add = () => {
    const label = newLabel.trim();
    if (!label) return;
    onChange([
      ...components,
      {
        id: crypto.randomUUID(),
        label,
        kind: newKind,
        defaultLocked: false,
        defaultCount: newKind === 'installments' ? 1 : undefined,
      },
    ]);
    setNewLabel('');
    setNewKind('single');
  };

  return (
    <div className="flex flex-col gap-2">
      {components.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          {emptyStateLabel}
        </p>
      ) : (
        components.map((c) => (
          <div
            key={c.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
          >
            <input
              value={c.label}
              onChange={(e) => update(c.id, { label: e.target.value })}
              className="w-28 shrink-0 border-0 bg-transparent p-0 text-sm font-medium text-foreground outline-none sm:w-32"
            />
            <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {c.kind === 'installments' ? installmentsKindLabel : singleKindLabel}
            </span>
            {c.kind === 'installments' && (
              <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                {defaultCountLabel}
                <input
                  type="number"
                  min={1}
                  value={c.defaultCount ?? 1}
                  onChange={(e) =>
                    update(c.id, { defaultCount: Math.max(1, Number(e.target.value) || 1) })
                  }
                  className="h-7 w-12 rounded-md border border-input bg-transparent px-1 text-center text-xs tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </label>
            )}
            <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              {defaultPercentLabel}
              <input
                type="number"
                min={0}
                max={100}
                step="1"
                value={c.defaultPercent ?? ''}
                placeholder="0"
                onChange={(e) =>
                  update(c.id, {
                    defaultPercent: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
                className="h-7 w-12 rounded-md border border-input bg-transparent px-1 text-center text-xs tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              %
            </label>
            <button
              type="button"
              onClick={() => update(c.id, { defaultLocked: !c.defaultLocked })}
              aria-pressed={c.defaultLocked}
              className={cn(
                'ml-auto flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors',
                c.defaultLocked
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted',
              )}
            >
              {c.defaultLocked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
              {defaultLockedLabel}
            </button>
            <button
              type="button"
              onClick={() => remove(c.id)}
              aria-label={removeLabel}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2">
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
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
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="size-3.5" />
          {addLabel}
        </Button>
      </div>
    </div>
  );
}
