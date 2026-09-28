'use client';

import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Step progress for the campaign wizards. Finished steps are clickable
 * (to go back); later ones aren't.
 */
export function WizardStepper({
  labels,
  current,
  onSelect,
}: {
  labels: string[];
  current: number;
  onSelect?: (index: number) => void;
}) {
  return (
    <ol className="flex items-center gap-2">
      {labels.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={label}
            className="flex min-w-0 flex-1 items-center gap-2 last:flex-none"
          >
            <button
              type="button"
              disabled={!done || !onSelect}
              onClick={() => onSelect?.(i)}
              aria-current={active ? 'step' : undefined}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-full py-1 pr-3 pl-1 transition-colors',
                active && 'bg-background ring-border shadow-sm ring-1',
                done && onSelect && 'hover:bg-background/70',
                'disabled:cursor-default'
              )}
            >
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                  done
                    ? 'bg-primary text-primary-foreground'
                    : active
                      ? 'bg-primary/15 text-primary ring-primary ring-2'
                      : 'bg-muted text-muted-foreground'
                )}
              >
                {done ? <Check className="size-4" /> : i + 1}
              </span>
              <span
                className={cn(
                  'hidden truncate text-sm font-medium sm:block',
                  active
                    ? 'text-foreground'
                    : done
                      ? 'text-primary'
                      : 'text-muted-foreground'
                )}
              >
                {label}
              </span>
            </button>
            {i < labels.length - 1 ? (
              <span className="bg-border h-0.5 min-w-4 flex-1 overflow-hidden rounded-full">
                <span
                  className={cn(
                    'bg-primary block h-full transition-all duration-500',
                    done ? 'w-full' : 'w-0'
                  )}
                />
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
