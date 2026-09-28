'use client';

import { useMemo } from 'react';
import { ArrowDown } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';
import {
  failureReasons,
  processingTimeline,
  replyTrend,
} from '@/lib/campaigns/metrics';
import type { Broadcast, BroadcastRecipient } from '@/types';

// Validated with the dataviz palette checker (light / dark surfaces).
const SERIES = {
  light: { sent: '#2563eb', delivered: '#059669', read: '#7c3aed' },
  dark: { sent: '#3b82f6', delivered: '#059669', read: '#8b5cf6' },
};

const pctOf = (n: number, d: number) =>
  d > 0 ? Math.round((n / d) * 1000) / 10 : 0;

/**
 * "Analytics" tab — rates, the delivery funnel, failure reasons by Meta
 * code, the cumulative processing timeline and the daily reply trend.
 */
export function CampaignAnalytics({
  broadcast,
  recipients,
  pendingCount,
}: {
  broadcast: Broadcast;
  recipients: BroadcastRecipient[];
  pendingCount: number;
}) {
  const t = useTranslations('Broadcasts.detail.analytics');
  const tFail = useTranslations('Settings.templates');
  const tm = useTranslations('Broadcasts.detail.monitor');
  const format = useFormatter();
  const { mode } = useTheme();
  const colors = SERIES[mode === 'dark' ? 'dark' : 'light'];

  const b = broadcast;
  const reasons = useMemo(() => failureReasons(recipients), [recipients]);
  const timeline = useMemo(() => processingTimeline(recipients), [recipients]);
  // eslint-disable-next-line react-hooks/purity -- "last 8 days" is relative to render time by design
  const trend = useMemo(() => replyTrend(recipients, Date.now()), [recipients]);

  const rates = [
    { label: t('totalRecipients'), value: format.number(b.total_recipients) },
    { label: t('queued'), value: format.number(pendingCount) },
    {
      label: t('deliveryRate'),
      value: `${pctOf(b.delivered_count, b.sent_count)}%`,
    },
    {
      label: t('readRate'),
      value: `${pctOf(b.read_count, b.delivered_count)}%`,
    },
    {
      label: t('replyRate'),
      value: `${pctOf(b.replied_count, b.delivered_count)}%`,
    },
    {
      label: t('failureRate'),
      value: `${pctOf(b.failed_count, b.sent_count + b.failed_count)}%`,
    },
  ];

  const funnel = [
    {
      key: 'sent',
      label: t('series.sent'),
      value: b.sent_count,
      bar: 'bg-blue-500/15 border-blue-500 text-blue-700 dark:text-blue-300',
      step: null,
    },
    {
      key: 'delivered',
      label: t('series.delivered'),
      value: b.delivered_count,
      bar: 'bg-emerald-500/15 border-emerald-500 text-emerald-700 dark:text-emerald-300',
      step: t('stepDelivered', { pct: pctOf(b.delivered_count, b.sent_count) }),
    },
    {
      key: 'read',
      label: t('series.read'),
      value: b.read_count,
      bar: 'bg-sky-500/15 border-sky-500 text-sky-700 dark:text-sky-300',
      step: t('stepRead', { pct: pctOf(b.read_count, b.delivered_count) }),
    },
    {
      key: 'replied',
      label: t('replies'),
      value: b.replied_count,
      bar: 'bg-violet-500/15 border-violet-500 text-violet-700 dark:text-violet-300',
      step: t('stepReplied', { pct: pctOf(b.replied_count, b.read_count) }),
    },
  ];
  const funnelMax = Math.max(b.sent_count, 1);
  const top = reasons[0];
  const topKey = top?.code != null ? `failure.${top.code}` : null;

  const timeLabel = (at: number) =>
    format.dateTime(new Date(at), { hour: '2-digit', minute: '2-digit' });
  const dayLabel = (at: number) =>
    format.dateTime(new Date(at), { month: 'short', day: 'numeric' });

  return (
    <div className="space-y-6">
      {/* Rates */}
      <div className="border-border bg-card grid grid-cols-2 overflow-hidden rounded-xl border sm:grid-cols-3 lg:grid-cols-6">
        {rates.map((r) => (
          <div
            key={r.label}
            className="border-border px-5 py-4 [&:not(:last-child)]:border-r"
          >
            <p className="text-muted-foreground font-mono text-[11px] tracking-[0.15em] uppercase">
              {r.label}
            </p>
            <p className="text-foreground mt-1 font-mono text-xl tabular-nums">
              {r.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* Funnel */}
        <section className="border-border bg-card rounded-xl border p-6">
          <Heading title={t('funnel')} hint={t('funnelHint')} />
          <div className="mt-5 space-y-1">
            {funnel.map((f) => (
              <div key={f.key}>
                {f.step ? (
                  <p className="text-primary flex items-center gap-1 py-1 pl-28 font-mono text-xs">
                    <ArrowDown className="size-3" />
                    {f.step}
                  </p>
                ) : null}
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground w-24 shrink-0 text-right font-mono text-xs tracking-[0.15em] uppercase">
                    {f.label}
                  </span>
                  <div className="flex-1">
                    <div
                      className={cn(
                        'flex h-10 items-center rounded-r-md border-l-2 px-3 font-mono text-sm tabular-nums',
                        f.bar
                      )}
                      style={{
                        width: `${Math.max(8, (f.value / funnelMax) * 100)}%`,
                      }}
                    >
                      {format.number(f.value)}
                    </div>
                  </div>
                  <span className="text-muted-foreground hidden w-28 shrink-0 font-mono text-xs sm:block">
                    {t('ofSent', { pct: pctOf(f.value, b.sent_count) })}
                  </span>
                </div>
              </div>
            ))}
            <div className="flex items-center gap-3 pt-3">
              <span className="w-24 shrink-0 text-right font-mono text-xs tracking-[0.15em] text-red-600 uppercase dark:text-red-400">
                {tm('failed')}
              </span>
              <div className="flex-1">
                <div
                  className="flex h-10 items-center rounded-r-md border-l-2 border-red-500 bg-red-500/10 px-3 font-mono text-sm text-red-700 tabular-nums dark:text-red-300"
                  style={{
                    width: `${Math.max(8, (b.failed_count / funnelMax) * 100)}%`,
                  }}
                >
                  {format.number(b.failed_count)}
                </div>
              </div>
              <span className="hidden w-28 shrink-0 sm:block" />
            </div>
          </div>
        </section>

        {/* Failure reasons */}
        <section className="border-border bg-card rounded-xl border p-6">
          <Heading title={t('failureReasons')} hint={t('failureHint')} />
          {reasons.length === 0 ? (
            <p className="text-muted-foreground mt-6 text-sm">
              {t('noFailures')}
            </p>
          ) : (
            <>
              <ul className="mt-5 space-y-4">
                {reasons.slice(0, 6).map((r) => (
                  <li key={`${r.code}-${r.title}`}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">
                        {r.code != null ? (
                          <span className="mr-2 font-mono text-xs text-red-600 dark:text-red-400">
                            {r.code}
                          </span>
                        ) : null}
                        <span className="text-foreground">{r.title}</span>
                      </span>
                      <span className="text-foreground font-mono tabular-nums">
                        {format.number(r.count)}
                      </span>
                    </div>
                    <div className="bg-muted mt-1.5 h-1 overflow-hidden rounded-full">
                      <div
                        className="h-full rounded-full bg-red-500/80"
                        style={{
                          width: `${(r.count / reasons[0].count) * 100}%`,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              {top ? (
                <div className="mt-5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-200">
                  {top.code != null ? (
                    <p className="font-semibold">
                      {t('topHint', { code: String(top.code) })}
                    </p>
                  ) : null}
                  {topKey && tFail.has(topKey) ? (
                    <p className="mt-1">{tFail(topKey)}</p>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* Processing timeline */}
        <section className="border-border bg-card rounded-xl border p-6">
          <Heading title={t('timeline')} />
          {timeline.length === 0 ? (
            <p className="text-muted-foreground mt-6 text-sm">
              {t('timelineEmpty')}
            </p>
          ) : (
            <>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={timeline}
                    margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid
                      vertical={false}
                      strokeDasharray="3 3"
                      className="stroke-border"
                    />
                    <XAxis
                      dataKey="at"
                      type="number"
                      domain={['dataMin', 'dataMax']}
                      tickFormatter={timeLabel}
                      tickLine={false}
                      axisLine={false}
                      className="font-mono text-[11px]"
                      minTickGap={32}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={48}
                      className="font-mono text-[11px]"
                      tickFormatter={(v) => format.number(v)}
                    />
                    <Tooltip
                      labelFormatter={(v) => timeLabel(Number(v))}
                      formatter={(v, name) => [format.number(Number(v)), name]}
                      contentStyle={{ borderRadius: 8, fontSize: 12 }}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Area
                      type="monotone"
                      dataKey="sent"
                      name={t('series.sent')}
                      stroke={colors.sent}
                      fill={colors.sent}
                      fillOpacity={0.08}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="delivered"
                      name={t('series.delivered')}
                      stroke={colors.delivered}
                      fill="transparent"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="read"
                      name={t('series.read')}
                      stroke={colors.read}
                      fill="transparent"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <table className="sr-only">
                <caption>{t('timeline')}</caption>
                <thead>
                  <tr>
                    <th>{t('time')}</th>
                    <th>{t('series.sent')}</th>
                    <th>{t('series.delivered')}</th>
                    <th>{t('series.read')}</th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.map((p) => (
                    <tr key={p.at}>
                      <td>{timeLabel(p.at)}</td>
                      <td>{p.sent}</td>
                      <td>{p.delivered}</td>
                      <td>{p.read}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>

        {/* Reply trend */}
        <section className="border-border bg-card rounded-xl border p-6">
          <Heading title={t('replyTrend')} hint={t('replyTrendHint')} />
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={trend}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              >
                <CartesianGrid
                  vertical={false}
                  strokeDasharray="3 3"
                  className="stroke-border"
                />
                <XAxis
                  dataKey="day"
                  tickFormatter={dayLabel}
                  tickLine={false}
                  axisLine={false}
                  className="font-mono text-[11px]"
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  className="font-mono text-[11px]"
                />
                <Tooltip
                  cursor={{ fillOpacity: 0.06 }}
                  labelFormatter={(v) => dayLabel(Number(v))}
                  formatter={(v) => [format.number(Number(v)), t('replies')]}
                  contentStyle={{ borderRadius: 8, fontSize: 12 }}
                />
                <Bar
                  dataKey="replies"
                  name={t('replies')}
                  fill={colors.read}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={36}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="sr-only">
            <caption>{t('replyTrend')}</caption>
            <thead>
              <tr>
                <th>{t('day')}</th>
                <th>{t('replies')}</th>
              </tr>
            </thead>
            <tbody>
              {trend.map((d) => (
                <tr key={d.day}>
                  <td>{dayLabel(d.day)}</td>
                  <td>{d.replies}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function Heading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-muted-foreground font-mono text-xs tracking-[0.2em] uppercase">
        {title}
      </p>
      {hint ? (
        <p className="text-muted-foreground font-mono text-xs">{hint}</p>
      ) : null}
    </div>
  );
}
