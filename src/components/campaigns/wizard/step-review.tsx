'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  FileDown,
  Globe,
  Loader2,
  Rocket,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import { templateSlots } from '@/lib/campaigns/advanced';
import { channelTotals } from '@/lib/campaigns/distribution';
import { effectiveRate } from '@/lib/campaigns/rate-limiter';
import type { Channel } from '@/components/whatsapp/channel-types';
import type { MessageTemplate } from '@/types';
import { PhonePreview, previewPropsFor } from './phone-preview';
import {
  DEFAULT_DELIVERY,
  channelLabel,
  chosenTemplates,
  estimateSeconds,
  planFor,
  rowFor,
  type AudienceStats,
  type WizardState,
} from './state';
import { useDuration } from './use-duration';
import { DeliverySettings } from './delivery-settings';

export interface ReviewChecks {
  templates: boolean;
  channels: boolean;
  audience: boolean;
  variables: boolean;
}

export function StepReview({
  state,
  update,
  channels,
  templates,
  stats,
  sampleRow,
  checks,
  busy,
  minSchedule,
  onLaunch,
  onSchedule,
  onSaveDraft,
}: {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  channels: Channel[];
  templates: MessageTemplate[];
  stats: AudienceStats | null;
  sampleRow: Record<string, string> | null;
  checks: ReviewChecks;
  busy: 'launch' | 'schedule' | 'draft' | null;
  minSchedule: string;
  onLaunch: () => void;
  onSchedule: () => void;
  onSaveDraft: () => void;
}) {
  const t = useTranslations('Campaigns.wizard.review');
  const td = useTranslations('Campaigns.wizard.distribution');
  const tdist = td;
  const ta = useTranslations('Campaigns.wizard.audience.sources');
  const tb = useTranslations('Campaigns.wizard.basics');
  const format = useFormatter();
  const duration = useDuration();
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const selected = channels.filter((c) => state.channelIds.includes(c.id));
  const plan = planFor(state, stats?.valid ?? 0);
  const total = plan.reduce((a, p) => a + p.count, 0);
  const totals = channelTotals(plan);
  const seconds = estimateSeconds(state, plan, selected);
  const rate = Math.max(
    ...selected.map((c) => effectiveRate(state.speed, c.throughput_level)),
    0
  );
  const union = chosenTemplates(state);
  const rows = union
    .map((r) => rowFor(templates, undefined, r))
    .filter((r): r is MessageTemplate => !!r);
  const cleaned = stats ? stats.invalid + stats.duplicates + stats.excluded : 0;

  const header = (() => {
    const kinds = rows.map((r) => r.header_type ?? null);
    const media = rows.map((r) => templateSlots(r).headerMedia).find(Boolean);
    if (media)
      return state.media[media]
        ? t('headerCustom', { type: media })
        : t('headerMedia', { type: media });
    if (kinds.includes('text')) return t('headerText');
    return t('headerNone');
  })();

  const firstPair = selected
    .flatMap((c) =>
      (state.channelTemplates[c.id] ?? []).map((ref) => ({
        c,
        row: rowFor(templates, c, ref),
      }))
    )
    .find((p) => p.row);
  const preview = firstPair?.row
    ? previewPropsFor({
        channelName: channelLabel(firstPair.c),
        channelPhone: firstPair.c.display_phone_number,
        template: firstPair.row,
        mapping: state.shared,
        media: state.media,
        sampleRow,
      })
    : null;

  const d = state.delivery ?? DEFAULT_DELIVERY;
  const deliverySummary =
    [
      d.interval && tdist('deliveryInterval'),
      d.pauseOnQualityHold && tdist('deliveryQualityHold'),
      d.stopOnMetaError && tdist('deliveryStopOnError'),
    ]
      .filter(Boolean)
      .join(' · ') || t('deliveryDefault');

  const summary: [string, string][] = [
    [t('campaign'), state.name.trim()],
    [
      t('audience'),
      t('audienceValue', {
        count: format.number(total),
        source: state.audience.source ? ta(state.audience.source) : '—',
      }),
    ],
    [t('channels'), selected.map(channelLabel).join(', ')],
    [t('messages'), t('messagesValue', { count: plan.length })],
    [t('type'), state.mode === 'standard' ? tb('standard') : tb('advanced')],
    ...(state.mode === 'advanced'
      ? [
          [
            t('distribution'),
            state.distribution === 'channel'
              ? td('byChannel')
              : state.distribution === 'template'
                ? td('byTemplate')
                : td('matrix'),
          ] as [string, string],
        ]
      : []),
    [t('header'), header],
    [t('duration'), t('durationValue', { time: duration(seconds), rate })],
    [t('delivery'), deliverySummary],
  ];

  const checkList: { ok: boolean; label: string }[] = [
    { ok: checks.templates, label: t('checks.templates') },
    {
      ok: checks.channels,
      label: t('checks.channels', { count: selected.length }),
    },
    {
      ok: checks.audience,
      label: t('checks.audience', { count: format.number(cleaned) }),
    },
    { ok: checks.variables, label: t('checks.variables') },
    { ok: true, label: t('checks.duplicates') },
    { ok: true, label: t('checks.excluded') },
  ];
  const allOk = checkList.every((c) => c.ok);
  // datetime-local strings compare in time order (same format).
  const scheduleValid = !!state.scheduleAt && state.scheduleAt > minSchedule;

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="space-y-6">
        <section className="border-border bg-card rounded-2xl border p-4 sm:p-6 lg:p-8">
          <h2 className="text-foreground text-base font-semibold sm:text-lg">
            {t('title')}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('subtitle', { count: total })}
          </p>

          <dl className="border-border mt-6 grid overflow-hidden rounded-xl border sm:grid-cols-2">
            {summary.map(([label, value], i) => (
              <div
                key={`${label}-${i}`}
                className={cn(
                  'border-border px-5 py-4',
                  i % 2 === 0 && 'sm:border-r',
                  i < summary.length - (summary.length % 2 === 0 ? 2 : 1) &&
                    'border-b'
                )}
              >
                <dt className="text-muted-foreground text-xs font-medium tracking-[0.12em] uppercase">
                  {label}
                </dt>
                <dd
                  className="text-foreground mt-1 truncate font-medium"
                  title={value}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="border-border mt-6 overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground bg-muted/30 text-xs tracking-[0.12em] uppercase">
                <tr>
                  <th className="px-5 py-3 text-left font-medium">
                    {t('colChannel')}
                  </th>
                  <th className="px-5 py-3 text-left font-medium">
                    {t('colTemplates')}
                  </th>
                  <th className="px-5 py-3 text-left font-medium">
                    {t('colReceivers')}
                  </th>
                  <th className="px-5 py-3 text-right font-medium">
                    {t('colShare')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {selected.map((c) => {
                  const ct = totals.get(c.id) ?? { receivers: 0, templates: 0 };
                  return (
                    <tr key={c.id}>
                      <td className="text-foreground px-5 py-3 font-medium">
                        {channelLabel(c)}
                      </td>
                      <td className="text-muted-foreground px-5 py-3 tabular-nums">
                        {ct.templates}
                      </td>
                      <td className="px-5 py-3 tabular-nums">
                        {format.number(ct.receivers)}
                      </td>
                      <td className="text-muted-foreground px-5 py-3 text-right tabular-nums">
                        {total ? Math.round((ct.receivers / total) * 100) : 0}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section
          className={cn(
            'rounded-2xl border p-4 sm:p-6 lg:p-8',
            allOk
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : 'border-amber-500/40 bg-amber-500/5'
          )}
        >
          <h3
            className={cn(
              'flex items-center gap-2 font-semibold',
              allOk
                ? 'text-emerald-800 dark:text-emerald-300'
                : 'text-amber-800 dark:text-amber-300'
            )}
          >
            {allOk ? (
              <ShieldCheck className="size-5" />
            ) : (
              <AlertTriangle className="size-5" />
            )}
            {allOk ? t('preflightOk') : t('preflightFix')}
          </h3>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {checkList.map((c) => (
              <li key={c.label} className="flex items-start gap-2 text-sm">
                {c.ok ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                ) : (
                  <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
                )}
                <span className="text-foreground">{c.label}</span>
              </li>
            ))}
          </ul>
        </section>

        {state.mode === 'standard' ? (
          <DeliverySettings state={state} update={update} />
        ) : null}

        <section className="border-border bg-card rounded-2xl border">
          <button
            type="button"
            aria-expanded={scheduleOpen}
            onClick={() => setScheduleOpen(!scheduleOpen)}
            className="flex w-full items-center gap-2 px-4 py-4 text-left sm:px-6 sm:py-5 lg:px-8"
          >
            <CalendarClock className="text-primary size-5" />
            <span className="text-foreground font-semibold">
              {t('scheduleLater')}
            </span>
            <span className="text-muted-foreground hidden text-sm sm:inline">
              {t('scheduleLaterHint')}
            </span>
            <ChevronDown
              className={cn(
                'text-muted-foreground ml-auto size-5 transition-transform',
                scheduleOpen && 'rotate-180'
              )}
            />
          </button>
          {scheduleOpen ? (
            <div className="border-border border-t px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
              <label className="block max-w-xs">
                <span className="text-muted-foreground mb-1.5 block text-xs font-medium tracking-[0.12em] uppercase">
                  {t('at')}
                </span>
                <input
                  type="datetime-local"
                  value={state.scheduleAt}
                  min={minSchedule}
                  onChange={(e) => update({ scheduleAt: e.target.value })}
                  className="border-border bg-background focus-visible:border-primary h-10 w-full rounded-lg border px-3 text-sm outline-none"
                />
              </label>
            </div>
          ) : null}
        </section>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-0">
        {preview ? <PhonePreview {...preview} /> : null}

        <section className="border-border bg-card rounded-2xl border p-5">
          <p className="text-muted-foreground text-xs font-medium tracking-[0.12em] uppercase">
            {t('next')}
          </p>
          <div className="mt-3 space-y-2.5">
            <button
              type="button"
              onClick={onLaunch}
              disabled={!allOk || busy !== null}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50 sm:h-12 sm:text-base"
            >
              {busy === 'launch' ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <Rocket className="size-5" />
              )}
              {busy === 'launch' ? t('launching') : t('launch')}
            </button>
            <button
              type="button"
              onClick={() =>
                scheduleOpen && scheduleValid
                  ? onSchedule()
                  : setScheduleOpen(true)
              }
              disabled={!allOk || busy !== null}
              className="border-primary text-primary hover:bg-primary/5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border text-sm font-semibold transition-colors disabled:opacity-50 sm:h-12 sm:text-base"
            >
              {busy === 'schedule' ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <CalendarClock className="size-5" />
              )}
              {t('schedule')}
            </button>
            <button
              type="button"
              onClick={onSaveDraft}
              disabled={busy !== null}
              className="border-border hover:bg-muted inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50 sm:h-12 sm:text-base"
            >
              {busy === 'draft' ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <FileDown className="size-5" />
              )}
              {t('saveDraft')}
            </button>
          </div>
          <p className="text-muted-foreground mt-3 text-center text-xs">
            {t('draftNote')}
          </p>
        </section>
        <p className="text-muted-foreground flex items-center justify-center gap-1.5 text-xs">
          <Globe className="size-3.5" />
          {t('footer')}
        </p>
      </aside>
    </div>
  );
}
