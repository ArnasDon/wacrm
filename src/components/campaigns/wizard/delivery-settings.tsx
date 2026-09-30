'use client';

import { useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import {
  DEFAULT_DELIVERY,
  type DeliveryState,
  type WizardState,
} from './state';

/** "Advanced delivery settings" — collapsible, three opt-in checkboxes. */
export function DeliverySettings({
  state,
  update,
  defaultOpen = false,
}: {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  defaultOpen?: boolean;
}) {
  const t = useTranslations('Campaigns.wizard.distribution');
  const [open, setOpen] = useState(defaultOpen);
  const d = state.delivery ?? DEFAULT_DELIVERY;
  const set = (patch: Partial<DeliveryState>) =>
    update({ delivery: { ...d, ...patch } });

  const options: { key: keyof DeliveryState; title: string; hint: string }[] = [
    {
      key: 'interval',
      title: t('deliveryInterval'),
      hint: t('deliveryIntervalHint'),
    },
    {
      key: 'pauseOnQualityHold',
      title: t('deliveryQualityHold'),
      hint: t('deliveryQualityHoldHint'),
    },
    {
      key: 'stopOnMetaError',
      title: t('deliveryStopOnError'),
      hint: t('deliveryStopOnErrorHint'),
    },
  ];

  return (
    <section className="border-border bg-card rounded-2xl border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-4 text-left sm:px-6 sm:py-5 lg:px-8"
      >
        <span className="text-foreground text-base font-semibold">
          {t('advancedSettings')}
        </span>
        <ChevronDown
          className={cn(
            'text-muted-foreground size-5 transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>
      {open ? (
        <div className="border-border space-y-3 border-t px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
          {options.map(({ key, title, hint }) => (
            <label
              key={key}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors',
                d[key]
                  ? 'border-primary/40 bg-primary/[0.04]'
                  : 'border-border hover:bg-muted/40'
              )}
            >
              <input
                type="checkbox"
                checked={d[key]}
                onChange={(e) => set({ [key]: e.target.checked })}
                className="accent-primary mt-0.5 size-4 shrink-0"
              />
              <span>
                <span className="text-foreground block text-sm font-semibold">
                  {title}
                </span>
                <span className="text-muted-foreground mt-0.5 block text-sm">
                  {hint}
                </span>
              </span>
            </label>
          ))}
          <p className="text-muted-foreground flex items-start gap-2 text-xs">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            {t('deliveryAuto')}
          </p>
        </div>
      ) : null}
    </section>
  );
}
