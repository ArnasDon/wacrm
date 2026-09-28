'use client';

import { CalendarClock, GitBranch, Rocket, Shuffle } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import type { Channel } from '@/components/whatsapp/channel-types';
import { channelLabel, type AudienceStats, type WizardState } from './types';

/** `datetime-local` value for a Date, in local time. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function StepLaunch({
  state,
  update,
  channels,
  stats,
  minSchedule,
}: {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  channels: Channel[];
  stats: AudienceStats;
  minSchedule: string;
}) {
  const t = useTranslations('Broadcasts.advanced.launch');
  const format = useFormatter();
  const chosen = channels.filter((c) => state.channelIds.includes(c.id));
  const seconds =
    stats.valid / Math.max(1, state.speed * Math.max(1, chosen.length));
  const minutes = Math.ceil(seconds / 60);

  const summary = [
    { label: t('recipients'), value: format.number(stats.valid) },
    {
      label: t('speed'),
      value: t('speedValue', { rate: state.speed, count: chosen.length }),
    },
    {
      label: t('eta'),
      value: seconds < 60 ? t('etaUnderMinute') : t('etaMinutes', { minutes }),
    },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <section className="border-border bg-card rounded-xl border p-5">
          <label className="block">
            <span className="text-foreground mb-1.5 block text-sm font-medium">
              {t('name')}
            </span>
            <input
              value={state.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder={t('namePlaceholder')}
              className="border-border bg-background focus-visible:border-ring h-10 w-full rounded-md border px-3 text-sm outline-none"
            />
          </label>
        </section>

        <section className="border-border bg-card rounded-xl border p-5">
          <p className="text-foreground mb-3 text-sm font-medium">
            {t('when')}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                {
                  key: 'now',
                  icon: Rocket,
                  title: t('now'),
                  hint: t('nowHint'),
                },
                {
                  key: 'later',
                  icon: CalendarClock,
                  title: t('later'),
                  hint: t('laterHint'),
                },
              ] as const
            ).map(({ key, icon: Icon, title, hint }) => {
              const active = state.scheduleMode === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => update({ scheduleMode: key })}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                    active
                      ? 'border-primary bg-primary/5 ring-primary ring-1'
                      : 'border-border hover:bg-muted/50'
                  )}
                >
                  <Icon
                    className={cn(
                      'mt-0.5 size-5',
                      active ? 'text-primary' : 'text-muted-foreground'
                    )}
                  />
                  <span>
                    <span className="text-foreground block text-sm font-medium">
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
          {state.scheduleMode === 'later' ? (
            <label className="mt-4 block">
              <span className="text-foreground mb-1.5 block text-sm font-medium">
                {t('at')}
              </span>
              <input
                type="datetime-local"
                value={state.scheduleAt}
                min={minSchedule}
                onChange={(e) => update({ scheduleAt: e.target.value })}
                className="border-border bg-background focus-visible:border-ring h-10 w-full rounded-md border px-3 text-sm outline-none sm:w-72"
              />
            </label>
          ) : null}
        </section>
      </div>

      <section className="border-border bg-card rounded-xl border p-5">
        <p className="text-muted-foreground font-mono text-[11px] tracking-[0.15em] uppercase">
          {t('summary')}
        </p>
        <dl className="mt-3 grid grid-cols-3 gap-3">
          {summary.map((s) => (
            <div
              key={s.label}
              className="border-border bg-background rounded-lg border px-3 py-2.5"
            >
              <dt className="text-muted-foreground text-xs">{s.label}</dt>
              <dd className="text-foreground mt-0.5 text-sm font-semibold tabular-nums">
                {s.value}
              </dd>
            </div>
          ))}
        </dl>

        <p className="text-muted-foreground mt-5 mb-2 text-xs font-medium">
          {t('channels')}
        </p>
        <div className="flex flex-wrap gap-2">
          {chosen.map((c) => (
            <span
              key={c.id}
              className="border-border inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm"
            >
              <span
                className="size-2.5 rounded-full"
                style={{ backgroundColor: c.color || '#25D366' }}
              />
              {channelLabel(c)}
            </span>
          ))}
        </div>

        <p className="text-muted-foreground mt-5 mb-2 text-xs font-medium">
          {t('templates')}
        </p>
        <ol className="space-y-1.5">
          {state.templates.map((ref, i) => (
            <li
              key={`${ref.name}:${ref.language}`}
              className="flex items-center gap-2 text-sm"
            >
              <span
                className={cn(
                  'flex size-5 items-center justify-center rounded-full font-mono text-[11px]',
                  i === 0
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground'
                )}
              >
                {i + 1}
              </span>
              <span className="text-foreground">{ref.name}</span>
              <span className="text-muted-foreground font-mono text-xs">
                {ref.language}
              </span>
            </li>
          ))}
        </ol>

        <div className="bg-muted/50 text-muted-foreground mt-5 space-y-2 rounded-lg p-3 text-xs">
          <p className="flex gap-2">
            <Shuffle className="mt-0.5 size-3.5 shrink-0" />
            {t('distribution')}
          </p>
          <p className="flex gap-2">
            <GitBranch className="mt-0.5 size-3.5 shrink-0" />
            {t('fallback')}
          </p>
        </div>
      </section>
    </div>
  );
}
