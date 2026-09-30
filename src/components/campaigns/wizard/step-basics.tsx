'use client';

import Link from 'next/link';
import { Check, Layers, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import {
  channelQuality,
  tierLimit,
  type Channel,
  type Quality,
} from '@/components/whatsapp/channel-types';
import { channelLabel, type Mode, type WizardState } from './state';

const QUALITY: Record<Quality, string> = {
  GREEN:
    'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  YELLOW:
    'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  RED: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400',
  UNKNOWN: 'border-border bg-muted text-muted-foreground',
};
const DOT: Record<Quality, string> = {
  GREEN: 'bg-emerald-500',
  YELLOW: 'bg-amber-500',
  RED: 'bg-red-500',
  UNKNOWN: 'bg-muted-foreground/50',
};

export function StepBasics({
  state,
  update,
  channels,
}: {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  channels: Channel[];
}) {
  const t = useTranslations('Campaigns.wizard.basics');
  const tc = useTranslations('WhatsAppChannels');
  const standard = state.mode === 'standard';

  const setMode = (mode: Mode) => {
    if (mode === state.mode) return;
    // Standard sends from one number with one template.
    if (mode === 'standard') {
      const first = state.channelIds[0];
      const tpl = first ? state.channelTemplates[first]?.[0] : undefined;
      update({
        mode,
        channelIds: first ? [first] : [],
        channelTemplates: first && tpl ? { [first]: [tpl] } : {},
      });
    } else update({ mode });
  };

  const toggle = (c: Channel) => {
    if (c.status !== 'connected') return;
    if (standard) {
      update({ channelIds: [c.id] });
      return;
    }
    update({
      channelIds: state.channelIds.includes(c.id)
        ? state.channelIds.filter((x) => x !== c.id)
        : [...state.channelIds, c.id],
    });
  };

  return (
    <div className="space-y-6">
      <section className="border-border bg-card rounded-2xl border p-4 sm:p-6 lg:p-8">
        <h2 className="text-foreground text-base font-semibold sm:text-lg">
          {t('title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>

        <p className="text-muted-foreground mt-6 mb-2 text-xs font-medium tracking-[0.12em] uppercase">
          {t('type')}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              {
                key: 'standard',
                icon: Send,
                title: t('standard'),
                hint: t('standardHint'),
              },
              {
                key: 'advanced',
                icon: Layers,
                title: t('advanced'),
                hint: t('advancedHint'),
              },
            ] as const
          ).map(({ key, icon: Icon, title, hint }) => {
            const active = state.mode === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => setMode(key)}
                className={cn(
                  'flex items-start gap-3 rounded-xl border p-4 text-left transition-colors',
                  active
                    ? 'border-foreground bg-foreground/[0.03] ring-foreground ring-1'
                    : 'border-border hover:bg-muted/50'
                )}
              >
                <span
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-lg',
                    active
                      ? 'bg-foreground text-background'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span>
                  <span className="text-foreground block text-sm font-semibold">
                    {title}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <label
          htmlFor="campaign-name"
          className="text-muted-foreground mt-6 mb-2 block text-xs font-medium tracking-[0.12em] uppercase"
        >
          {t('name')}
        </label>
        <input
          id="campaign-name"
          autoFocus
          value={state.name}
          maxLength={120}
          onChange={(e) => update({ name: e.target.value })}
          placeholder={t('namePlaceholder')}
          className="border-border bg-background focus-visible:border-primary focus-visible:ring-primary/20 h-11 w-full rounded-lg border px-3 text-sm outline-none focus-visible:ring-4 sm:h-12 sm:px-4 sm:text-base"
        />
        <p className="text-muted-foreground mt-1.5 text-xs">{t('nameHint')}</p>
      </section>

      <section className="border-border bg-card rounded-2xl border p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-foreground text-base font-semibold sm:text-lg">
              {t('channels')}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {standard ? t('channelsHintStandard') : t('channelsHintAdvanced')}
            </p>
          </div>
          {state.channelIds.length > 0 ? (
            <span className="border-border bg-background rounded-full border px-3 py-1 text-sm">
              {t('selected', { count: state.channelIds.length })}
            </span>
          ) : null}
        </div>

        {channels.length === 0 ? (
          <div className="border-border text-muted-foreground mt-5 rounded-xl border border-dashed p-8 text-center text-sm">
            <p>{t('noChannels')}</p>
            <Link
              href="/whatsapp"
              className="text-primary mt-2 inline-block font-medium hover:underline"
            >
              {t('connect')}
            </Link>
          </div>
        ) : (
          <ul className="border-border divide-border mt-5 divide-y overflow-hidden rounded-xl border">
            {channels.map((c) => {
              const active = state.channelIds.includes(c.id);
              const disabled = c.status !== 'connected';
              const quality = channelQuality(c);
              const limit = tierLimit(c);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    role={standard ? 'radio' : 'checkbox'}
                    aria-checked={active}
                    disabled={disabled}
                    onClick={() => toggle(c)}
                    className={cn(
                      'flex w-full flex-wrap items-center gap-3 px-4 py-3.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:flex-nowrap',
                      active ? 'bg-primary/[0.04]' : 'hover:bg-muted/40'
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-5 shrink-0 items-center justify-center border',
                        standard ? 'rounded-full' : 'rounded',
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background'
                      )}
                    >
                      {active ? (
                        standard ? (
                          <span className="size-2 rounded-full bg-white" />
                        ) : (
                          <Check className="size-3.5" />
                        )
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground block truncate font-medium">
                        {channelLabel(c)}
                      </span>
                      <span className="text-muted-foreground block font-mono text-sm">
                        {c.display_phone_number ?? c.phone_number_id}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      {c.waba_name ? (
                        <span className="bg-muted text-muted-foreground rounded-md px-2 py-1 text-xs">
                          {c.waba_name}
                        </span>
                      ) : null}
                      {disabled ? (
                        <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-1 text-xs">
                          {t('disconnected')}
                        </span>
                      ) : (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
                            QUALITY[quality]
                          )}
                        >
                          <span
                            className={cn(
                              'size-1.5 rounded-full',
                              DOT[quality]
                            )}
                          />
                          {tc(`quality.${quality}`)}
                        </span>
                      )}
                      {limit ? (
                        <span className="border-border rounded-full border px-2.5 py-1 text-xs">
                          {limit === 'UNLIMITED'
                            ? t('tierUnlimited')
                            : t('tier', { limit })}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
