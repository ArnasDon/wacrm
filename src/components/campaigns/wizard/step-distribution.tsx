'use client';

import { useFormatter, useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import {
  channelTotals,
  type DistributionMode,
} from '@/lib/campaigns/distribution';
import type { Channel } from '@/components/whatsapp/channel-types';
import { channelLabel, planFor, type WizardState } from './state';
import { DeliverySettings } from './delivery-settings';

export function StepDistribution({
  state,
  update,
  channels,
  recipients,
}: {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  channels: Channel[];
  /** Valid recipients in the audience. */
  recipients: number;
}) {
  const t = useTranslations('Campaigns.wizard.distribution');
  const format = useFormatter();

  const selected = channels.filter((c) => state.channelIds.includes(c.id));
  const plan = planFor(state, recipients);
  const total = plan.reduce((a, p) => a + p.count, 0);
  const totals = channelTotals(plan);

  const modes: { key: DistributionMode; title: string; hint: string }[] = [
    { key: 'template', title: t('byTemplate'), hint: t('byTemplateHint') },
    { key: 'channel', title: t('byChannel'), hint: t('byChannelHint') },
    { key: 'matrix', title: t('matrix'), hint: t('matrixHint') },
  ];
  const card = 'border-border bg-card rounded-2xl border p-4 sm:p-6 lg:p-8';

  return (
    <div className="space-y-6">
      <section className={card}>
        <h2 className="text-foreground text-base font-semibold sm:text-lg">
          {t('title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('subtitle', { count: format.number(total) })}
        </p>

        <div className="mt-6 grid gap-3 lg:grid-cols-3">
          {modes.map((m) => {
            const active = state.distribution === m.key;
            return (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => update({ distribution: m.key })}
                className={cn(
                  'flex items-start gap-3 rounded-xl border p-5 text-left transition-colors',
                  active
                    ? 'border-foreground ring-foreground ring-1'
                    : 'border-border hover:bg-muted/40'
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                    active ? 'border-foreground' : 'border-border'
                  )}
                >
                  {active ? (
                    <span className="bg-foreground size-2 rounded-full" />
                  ) : null}
                </span>
                <span>
                  <span className="text-foreground block font-semibold">
                    {m.title}
                  </span>
                  <span className="text-muted-foreground mt-1 block text-sm">
                    {m.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <label className="mt-6 block max-w-sm">
          <span className="text-muted-foreground mb-2 block text-xs font-medium tracking-[0.12em] uppercase">
            {t('maxContacts')}
          </span>
          <input
            type="number"
            min={0}
            value={state.maxContacts || ''}
            placeholder={String(recipients)}
            onChange={(e) =>
              update({
                maxContacts: Math.max(
                  0,
                  Math.floor(Number(e.target.value) || 0)
                ),
              })
            }
            className="border-border bg-background focus-visible:border-primary h-11 w-full rounded-lg border px-3 text-sm outline-none"
          />
          <span className="text-muted-foreground mt-1 block text-xs">
            {t('maxHint')}
          </span>
        </label>

        <p className="text-muted-foreground mt-6 mb-3 text-xs font-medium tracking-[0.12em] uppercase">
          {t('splitAcross', { count: selected.length })}
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {selected.map((c) => {
            const ct = totals.get(c.id) ?? { receivers: 0, templates: 0 };
            const pct =
              total > 0 ? Math.round((ct.receivers / total) * 100) : 0;
            return (
              <div key={c.id} className="border-border rounded-xl border p-5">
                <p className="text-foreground truncate font-semibold">
                  {channelLabel(c)}
                </p>
                <p className="text-muted-foreground font-mono text-xs">
                  {c.display_phone_number}
                </p>
                <dl className="mt-4 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">{t('templates')}</dt>
                    <dd className="font-medium tabular-nums">{ct.templates}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">{t('receivers')}</dt>
                    <dd className="font-semibold tabular-nums">
                      {format.number(ct.receivers)}
                    </dd>
                  </div>
                </dl>
                <div className="bg-muted mt-3 h-1.5 overflow-hidden rounded-full">
                  <div
                    className="bg-primary h-full rounded-full"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-muted-foreground mt-1.5 text-xs">
                  {t('share', { pct })}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <DeliverySettings state={state} update={update} defaultOpen />
    </div>
  );
}
