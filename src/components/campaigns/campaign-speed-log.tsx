'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { useTheme } from '@/hooks/use-theme';
import { createClient } from '@/lib/supabase/client';
import {
  speedSeconds,
  type SpeedLogRow,
  type SpeedSecond,
} from '@/lib/campaigns/speed-log-shared';

// Same validated palette as the Analytics tab (sent / delivered), plus
// the status red for Meta's "too fast" and a neutral for our limit.
const SERIES = {
  light: {
    sent: '#2563eb',
    accepted: '#059669',
    throttled: '#dc2626',
    limit: '#94a3b8',
  },
  dark: {
    sent: '#3b82f6',
    accepted: '#059669',
    throttled: '#f87171',
    limit: '#64748b',
  },
};
const PAGE = 1000;
const LIVE_POLL_MS = 3_000;
const SHOWN_ROWS = 120;

/**
 * "Speed per second" — for every second the campaign sent: requests we
 * sent to Meta, how many Meta accepted, throttled (130429) or rejected,
 * and our limiter's pace; per channel on hover. From campaign_speed_log
 * (migration 056), refreshed every few seconds while sending.
 */
export function CampaignSpeedLog({
  broadcastId,
  live,
  channelName,
}: {
  broadcastId: string;
  live: boolean;
  channelName: (id?: string | null) => string;
}) {
  const t = useTranslations('Broadcasts.detail.speed');
  const format = useFormatter();
  const { mode } = useTheme();
  const colors = SERIES[mode === 'dark' ? 'dark' : 'light'];
  const [rows, setRows] = useState<SpeedLogRow[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const db = createClient();
    const all: SpeedLogRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from('campaign_speed_log')
        .select(
          'whatsapp_config_id, second, sent, accepted, throttled, failed, limit_rate, worker, role, path, in_flight, max_in_flight, tier_rate, cap_rate, rss_mb, heap_mb, cpu_pct, load_avg, event_loop_lag_ms'
        )
        .eq('broadcast_id', broadcastId)
        .order('second', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) break; // table not there yet: show the empty state
      all.push(...((data ?? []) as SpeedLogRow[]));
      if (!data || data.length < PAGE) break;
    }
    setRows(all);
  }, [broadcastId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, LIVE_POLL_MS);
    return () => clearInterval(id);
  }, [live, load]);

  const seconds = useMemo(() => speedSeconds(rows ?? []), [rows]);
  const start = seconds[0]?.at ?? 0;
  const summary = useMemo(() => {
    const n = Math.max(1, seconds.length);
    const sum = (k: 'sent' | 'accepted' | 'throttled' | 'failed') =>
      seconds.reduce((a, s) => a + s[k], 0);
    return {
      avgSent: sum('sent') / n,
      avgAccepted: sum('accepted') / n,
      peakSent: Math.max(0, ...seconds.map((s) => s.sent)),
      peakAccepted: Math.max(0, ...seconds.map((s) => s.accepted)),
      throttled: sum('throttled'),
      failed: sum('failed'),
      duration: seconds.length,
      workers: Math.max(0, ...seconds.map((s) => s.workers)),
      peakRss: Math.max(0, ...seconds.map((s) => s.rssMb)),
      peakCpu: Math.max(0, ...seconds.map((s) => s.cpuPct)),
      peakLoad: Math.max(0, ...seconds.map((s) => s.loadAvg)),
      peakLag: Math.max(0, ...seconds.map((s) => s.lagMs)),
      peakInFlight: Math.max(0, ...seconds.map((s) => s.inFlight)),
    };
  }, [seconds]);
  // Rate-limit settings per channel, from the latest second that has them.
  const limits = useMemo(() => {
    const out: Record<
      string,
      { tier: number; cap: number; pace: number; maxInFlight: number }
    > = {};
    for (const s of seconds)
      for (const [id, c] of Object.entries(s.byChannel))
        if (c.tier || c.limit)
          out[id] = {
            tier: c.tier,
            cap: c.cap,
            pace: c.limit,
            maxInFlight: c.maxInFlight,
          };
    return out;
  }, [seconds]);
  const hasSystem = summary.workers > 0;

  const rate = (r: number) =>
    t('perSecond', { rate: r >= 10 ? Math.round(r) : Math.round(r * 10) / 10 });
  const clock = (at: number) =>
    format.dateTime(new Date(at), {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  const breakdown = (s: SpeedSecond) =>
    Object.entries(s.byChannel)
      .map(
        ([id, c]) =>
          `${channelName(id) || '—'}: ${c.sent} ${t('columns.sent')}, ${c.accepted} ${t('columns.accepted')}` +
          (c.throttled ? `, ${c.throttled} ${t('columns.throttled')}` : '') +
          (c.failed ? `, ${c.failed} ${t('columns.failed')}` : '') +
          (c.inFlight
            ? ` · ${t('columns.inFlight')} ${c.inFlight}/${c.maxInFlight}`
            : '')
      )
      .concat(
        Object.entries(s.byWorker).map(
          ([id, w]) =>
            `${id} (${w.role}${w.path ? ', ' + w.path : ''}): ${w.sent} ${t('columns.sent')} · ${w.rssMb} MB · ${t('columns.cpu')} ${w.cpuPct}% · ${t('columns.load')} ${w.loadAvg} · ${t('lag')} ${w.lagMs} ms`
        )
      )
      .join('\n');

  const tableRows = live ? [...seconds].reverse() : seconds;
  const shown = showAll ? tableRows : tableRows.slice(0, SHOWN_ROWS);

  return (
    <section className="border-border bg-card rounded-xl border p-4 sm:p-5">
      <h3 className="text-foreground font-semibold">{t('title')}</h3>
      <p className="text-muted-foreground mt-0.5 text-sm">{t('subtitle')}</p>

      {rows === null ? null : seconds.length === 0 ? (
        <p className="text-muted-foreground mt-6 text-sm">{t('empty')}</p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              [t('avgSent'), rate(summary.avgSent)],
              [t('avgAccepted'), rate(summary.avgAccepted)],
              [t('peak'), rate(summary.peakSent)],
              [t('duration'), t('seconds', { count: summary.duration })],
              [t('throttled'), format.number(summary.throttled)],
              [t('failed'), format.number(summary.failed)],
            ].map(([label, value]) => (
              <div key={label} className="border-border rounded-lg border p-3">
                <dt className="text-muted-foreground text-xs">{label}</dt>
                <dd className="text-foreground mt-1 font-mono text-lg tabular-nums">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          {hasSystem ? (
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                [t('workers'), format.number(summary.workers)],
                [
                  t('peakMemory'),
                  `${format.number(Math.round(summary.peakRss))} MB`,
                ],
                [t('peakCpu'), `${Math.round(summary.peakCpu)}%`],
                [t('peakLoad'), String(summary.peakLoad)],
                [t('peakLag'), `${Math.round(summary.peakLag)} ms`],
                [t('peakInFlight'), format.number(summary.peakInFlight)],
              ].map(([label, value]) => (
                <div key={label} className="bg-muted/40 rounded-lg p-3">
                  <dt className="text-muted-foreground text-xs">{label}</dt>
                  <dd className="text-foreground mt-1 font-mono text-base tabular-nums">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {Object.keys(limits).length ? (
            <div className="mt-3 text-sm">
              <span className="text-muted-foreground">{t('limits')}: </span>
              {Object.entries(limits)
                .map(([id, l]) =>
                  t('limitLine', {
                    channel: channelName(id) || '—',
                    tier: Math.round(l.tier),
                    cap: Math.round(l.cap),
                    pace: Math.round(l.pace * 10) / 10,
                    inflight: l.maxInFlight,
                  })
                )
                .join(' · ')}
            </div>
          ) : null}

          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={seconds}
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
                  tickFormatter={(v) =>
                    `+${Math.round((Number(v) - start) / 1000)}s`
                  }
                  tickLine={false}
                  axisLine={false}
                  className="font-mono text-[11px]"
                  minTickGap={32}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  allowDecimals={false}
                  className="font-mono text-[11px]"
                />
                <Tooltip
                  labelFormatter={(v) => clock(Number(v))}
                  formatter={(v, name) => [format.number(Number(v)), name]}
                  contentStyle={{ borderRadius: 8, fontSize: 12 }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Line
                  type="stepAfter"
                  dataKey="limit"
                  name={t('series.limit')}
                  stroke={colors.limit}
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="sent"
                  name={t('series.sent')}
                  stroke={colors.sent}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="accepted"
                  name={t('series.accepted')}
                  stroke={colors.accepted}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="throttled"
                  name={t('series.throttled')}
                  stroke={colors.throttled}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="border-border mt-4 max-h-96 overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground sticky top-0 text-left text-xs">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('columns.time')}</th>
                  <th className="px-3 py-2 text-right font-medium">
                    {t('columns.sent')}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    {t('columns.accepted')}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    {t('columns.throttled')}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    {t('columns.failed')}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    {t('columns.limit')}
                  </th>
                  {hasSystem ? (
                    <>
                      <th className="px-3 py-2 text-right font-medium">
                        {t('columns.inFlight')}
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        {t('columns.workers')}
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        {t('columns.cpu')}
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        {t('columns.memory')}
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        {t('columns.load')}
                      </th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {shown.map((s) => (
                  <tr
                    key={s.at}
                    title={breakdown(s)}
                    className="border-border border-t"
                  >
                    <td className="px-3 py-1.5">
                      {clock(s.at)}{' '}
                      <span className="text-muted-foreground text-xs">
                        +{Math.round((s.at - start) / 1000)}s
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right">{s.sent}</td>
                    <td className="px-3 py-1.5 text-right">{s.accepted}</td>
                    <td
                      className={
                        'px-3 py-1.5 text-right' +
                        (s.throttled ? ' text-red-600 dark:text-red-400' : '')
                      }
                    >
                      {s.throttled}
                    </td>
                    <td className="px-3 py-1.5 text-right">{s.failed}</td>
                    <td className="text-muted-foreground px-3 py-1.5 text-right">
                      {s.limit ? Math.round(s.limit) : '—'}
                    </td>
                    {hasSystem ? (
                      <>
                        <td className="text-muted-foreground px-3 py-1.5 text-right">
                          {s.maxInFlight
                            ? `${s.inFlight}/${s.maxInFlight}`
                            : '—'}
                        </td>
                        <td className="text-muted-foreground px-3 py-1.5 text-right">
                          {s.workers || '—'}
                        </td>
                        <td className="text-muted-foreground px-3 py-1.5 text-right">
                          {s.workers ? `${Math.round(s.cpuPct)}%` : '—'}
                        </td>
                        <td className="text-muted-foreground px-3 py-1.5 text-right">
                          {s.workers ? `${Math.round(s.rssMb)} MB` : '—'}
                        </td>
                        <td className="text-muted-foreground px-3 py-1.5 text-right">
                          {s.workers ? s.loadAvg : '—'}
                        </td>
                      </>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {tableRows.length > shown.length ? (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="text-primary mt-2 text-sm hover:underline"
            >
              {t('showAll', { count: tableRows.length })}
            </button>
          ) : null}
          <p className="text-muted-foreground mt-3 text-xs">{t('note')}</p>
        </>
      )}
    </section>
  );
}
