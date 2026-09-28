'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Broadcast, type BroadcastStatus } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  FilePen,
  Loader2,
  Plus,
  Radio,
  Search,
  XCircle,
  Zap,
} from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { cn } from '@/lib/utils';
import {
  ADVANCED_DRAFT_KEY,
  STANDARD_DRAFT_KEY,
  clearDraft,
} from '@/lib/campaigns/draft-storage';
import { useTranslations, useFormatter } from 'next-intl';

/**
 * Poll cadence while any campaign is sending. Kept modest so we don't
 * beat on Supabase — the aggregate trigger in migration 003 keeps
 * counts consistent; we just need to surface the freshest snapshot.
 */
const POLL_INTERVAL_MS = 5_000;

type Filter = 'all' | BroadcastStatus;
const FILTERS: { key: Filter; icon: typeof Radio }[] = [
  { key: 'all', icon: Radio },
  { key: 'sending', icon: Radio },
  { key: 'scheduled', icon: CalendarClock },
  { key: 'draft', icon: FilePen },
  { key: 'sent', icon: CheckCircle2 },
  { key: 'failed', icon: XCircle },
];

const STATUS_BADGE: Record<BroadcastStatus, { dot: string; chip: string }> = {
  sending: {
    dot: 'bg-emerald-500',
    chip: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  scheduled: {
    dot: 'bg-blue-500',
    chip: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  },
  draft: {
    dot: 'bg-neutral-400',
    chip: 'border-border bg-muted text-muted-foreground',
  },
  sent: {
    dot: 'bg-neutral-500',
    chip: 'border-border bg-muted text-foreground',
  },
  failed: {
    dot: 'bg-red-500',
    chip: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  },
};

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

export default function BroadcastsPage() {
  const router = useRouter();
  // "New campaign" starts fresh; a refresh inside the wizard restores.
  const startNewCampaign = () => {
    clearDraft(STANDARD_DRAFT_KEY, ADVANCED_DRAFT_KEY);
    router.push('/broadcasts/new');
  };
  const t = useTranslations('Broadcasts.page');
  const format = useFormatter();
  const canCreate = useCan('send-messages');
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  // Used to kick off polling only while something is actively sending.
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchBroadcasts() {
    try {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from('broadcasts')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;
      setBroadcasts(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorLoad'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchBroadcasts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const anySending = useMemo(
    () => broadcasts.some((b) => b.status === 'sending'),
    [broadcasts]
  );

  useEffect(() => {
    function startPolling() {
      if (pollTimer.current) return;
      pollTimer.current = setInterval(fetchBroadcasts, POLL_INTERVAL_MS);
    }
    function stopPolling() {
      if (!pollTimer.current) return;
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }

    // Pause polling while the tab is hidden — keeps Supabase cold when
    // the user is away, and ensures a fresh fetch the moment they
    // refocus so they don't see stale data on return.
    function handleVisibilityChange() {
      if (!anySending) return;
      if (document.visibilityState === 'hidden') {
        stopPolling();
      } else {
        fetchBroadcasts();
        startPolling();
      }
    }

    if (anySending && document.visibilityState === 'visible') {
      startPolling();
    } else {
      stopPolling();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anySending]);

  const live = broadcasts.filter((b) => b.status === 'sending');

  // All-time totals across every campaign.
  const totals = useMemo(() => {
    const sum = (k: keyof Broadcast) =>
      broadcasts.reduce((acc, b) => acc + (Number(b[k]) || 0), 0);
    const sent = sum('sent_count');
    const delivered = sum('delivered_count');
    const read = sum('read_count');
    const replied = sum('replied_count');
    const failed = sum('failed_count');
    const upcoming = broadcasts
      .filter((b) => b.status === 'scheduled' && b.scheduled_at)
      .map((b) => new Date(b.scheduled_at!))
      .filter((d) => d.getTime() > Date.now())
      .sort((a, b) => a.getTime() - b.getTime());
    return {
      processed: sent + failed,
      deliveryRate: pct(delivered, sent),
      readRate: pct(read, delivered),
      replied,
      replyRate: pct(replied, delivered),
      failed,
      failRate: pct(failed, sent + failed),
      scheduled: broadcasts.filter((b) => b.status === 'scheduled').length,
      next: upcoming[0] ?? null,
    };
  }, [broadcasts]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      all: broadcasts.length,
      sending: 0,
      scheduled: 0,
      draft: 0,
      sent: 0,
      failed: 0,
    };
    for (const b of broadcasts) c[b.status] = (c[b.status] ?? 0) + 1;
    return c;
  }, [broadcasts]);

  const rows = broadcasts.filter((b) => {
    if (filter !== 'all' && b.status !== filter) return false;
    const q = search.trim().toLowerCase();
    return (
      !q ||
      b.name.toLowerCase().includes(q) ||
      b.template_name.toLowerCase().includes(q)
    );
  });

  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top indeterminate progress bar: only visible while a campaign
          is mid-send. Pure CSS animation so no extra deps. */}
      {anySending && (
        <div
          role="progressbar"
          aria-label={t('broadcastInProgress')}
          className="broadcast-indeterminate bg-muted fixed inset-x-0 top-0 z-40 h-0.5 overflow-hidden"
        >
          <div className="broadcast-indeterminate-bar bg-primary h-0.5" />
          <style jsx>{`
            .broadcast-indeterminate-bar {
              width: 33%;
              transform: translateX(-100%);
              animation: broadcast-slide 1.6s cubic-bezier(0.4, 0, 0.2, 1)
                infinite;
            }
            @keyframes broadcast-slide {
              0% {
                transform: translateX(-100%);
              }
              100% {
                transform: translateX(400%);
              }
            }
          `}</style>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-foreground text-3xl font-bold tracking-tight">
            {t('title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
        </div>
        <GatedButton
          canAct={canCreate}
          gateReason="create campaigns"
          onClick={startNewCampaign}
          className="bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4"
        >
          <Plus className="h-4 w-4" />
          {t('newBroadcast')}
        </GatedButton>
      </div>

      {broadcasts.length === 0 ? (
        <div className="border-border bg-card flex h-64 flex-col items-center justify-center rounded-xl border">
          <Radio className="text-muted-foreground mb-3 h-10 w-10" />
          <p className="text-foreground text-sm font-medium">
            {t('noBroadcastsYet')}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {t('createFirst')}
          </p>
          <GatedButton
            canAct={canCreate}
            gateReason="create campaigns"
            onClick={startNewCampaign}
            className="bg-primary text-primary-foreground hover:bg-primary/90 mt-4"
          >
            <Plus className="h-4 w-4" />
            {t('newBroadcast')}
          </GatedButton>
        </div>
      ) : (
        <>
          {/* Live now — campaigns currently transmitting. */}
          {live.length > 0 ? (
            <section className="bg-card overflow-hidden rounded-xl border border-emerald-500/40">
              <div className="border-border flex items-center gap-2 border-b px-5 py-3 font-mono text-xs font-semibold tracking-[0.2em] text-emerald-700 uppercase dark:text-emerald-400">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
                {t('liveNow', { count: live.length })}
              </div>
              <div className="divide-border grid divide-y md:grid-cols-2 md:divide-x md:divide-y-0">
                {live.map((b) => {
                  const processed = b.sent_count + b.failed_count;
                  const progress = pct(processed, b.total_recipients);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => router.push(`/broadcasts/${b.id}`)}
                      className="group hover:bg-muted/40 space-y-3 p-5 text-left transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-foreground truncate font-semibold">
                            {b.name}
                          </p>
                          <p className="text-muted-foreground mt-0.5 truncate font-mono text-[11px] tracking-widest uppercase">
                            {b.template_name}
                          </p>
                        </div>
                        <ArrowRight className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
                      </div>
                      <div className="flex items-end justify-between gap-3">
                        <div>
                          <p className="text-primary text-3xl font-semibold tabular-nums">
                            {Math.round(progress)}%
                          </p>
                          <p className="text-muted-foreground font-mono text-xs">
                            {t('processed', {
                              done: format.number(processed),
                              total: format.number(b.total_recipients),
                            })}
                          </p>
                        </div>
                        <p className="text-muted-foreground font-mono text-xs">
                          {t('deliveryPct', {
                            rate: pct(b.delivered_count, b.sent_count),
                          })}
                        </p>
                      </div>
                      {/* Segmented progress bar. */}
                      <div className="flex gap-0.5" aria-hidden>
                        {Array.from({ length: 40 }, (_, i) => (
                          <span
                            key={i}
                            className={cn(
                              'h-1 flex-1 rounded-full',
                              (i + 1) / 40 <= progress / 100
                                ? 'bg-primary'
                                : 'bg-muted'
                            )}
                          />
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {/* All-time totals. */}
          <section className="border-border bg-card flex flex-wrap items-center gap-x-8 gap-y-5 rounded-xl border px-6 py-5">
            <div className="flex items-center gap-4">
              <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-full">
                <Zap className="size-5" />
              </div>
              <div>
                <p className="text-foreground text-3xl font-bold tabular-nums">
                  {format.number(totals.processed)}
                </p>
                <p className="text-muted-foreground text-sm">
                  {t('messagesProcessed')}
                </p>
              </div>
            </div>
            <div className="bg-border hidden h-12 w-px lg:block" />
            <Metric
              value={`${totals.deliveryRate}%`}
              label={t('deliveryRate')}
              fill={totals.deliveryRate}
              bar="bg-emerald-500"
            />
            <Metric
              value={`${totals.readRate}%`}
              label={t('readRate')}
              fill={totals.readRate}
              bar="bg-sky-500"
            />
            <Metric
              value={format.number(totals.replied)}
              label={t('replies')}
              fill={totals.replyRate}
              bar="bg-violet-500"
            />
            <Metric
              value={format.number(totals.failed)}
              label={t('failed')}
              fill={totals.failRate}
              bar="bg-red-500"
            />
            <div className="ml-auto text-right">
              <p className="text-foreground text-xl font-semibold">
                {t('scheduledCount', { count: totals.scheduled })}
              </p>
              {totals.next ? (
                <p className="text-muted-foreground text-sm">
                  {t('nextScheduled', {
                    time: when(totals.next.toISOString()),
                  })}
                </p>
              ) : null}
            </div>
          </section>

          {/* Filters + search. */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex flex-1 flex-wrap gap-2">
              {FILTERS.map(({ key, icon: Icon }) => {
                const active = filter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilter(key)}
                    aria-pressed={active}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
                      active
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-border bg-card text-foreground hover:bg-muted'
                    )}
                  >
                    {key !== 'all' ? <Icon className="size-4" /> : null}
                    {t(`filters.${key}`)}
                    <span
                      className={cn(
                        'rounded-full px-2 text-xs tabular-nums',
                        active
                          ? 'bg-background/20'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {counts[key]}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="relative lg:w-72">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('search')}
                aria-label={t('search')}
                className="bg-card h-10 pl-9"
              />
            </div>
          </div>

          {/* Campaigns. */}
          <div className="border-border bg-card overflow-hidden rounded-xl border">
            <div className="border-border text-muted-foreground hidden grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1.3fr)_minmax(0,0.4fr)] gap-6 border-b px-6 py-3 text-xs font-semibold tracking-wider uppercase md:grid">
              <span>{t('columns.campaign')}</span>
              <span>{t('columns.status')}</span>
              <span>{t('columns.pipeline')}</span>
              <span className="text-right">{t('columns.replies')}</span>
            </div>
            {rows.length === 0 ? (
              <p className="text-muted-foreground px-6 py-12 text-center text-sm">
                {t('noMatches')}
              </p>
            ) : (
              <ul className="divide-border divide-y">
                {rows.map((b) => {
                  const badge = STATUS_BADGE[b.status] ?? STATUS_BADGE.draft;
                  const total = Math.max(b.total_recipients, 1);
                  // Stacked pipeline: read ⊂ delivered ⊂ sent; failed apart.
                  const readW = pct(b.read_count, total);
                  const deliveredW = pct(
                    Math.max(b.delivered_count - b.read_count, 0),
                    total
                  );
                  const sentW = pct(
                    Math.max(b.sent_count - b.delivered_count, 0),
                    total
                  );
                  const failedW = pct(b.failed_count, total);
                  const started =
                    b.status !== 'draft' && b.status !== 'scheduled';
                  return (
                    <li key={b.id}>
                      <button
                        type="button"
                        onClick={() => router.push(`/broadcasts/${b.id}`)}
                        className="hover:bg-muted/40 grid w-full gap-3 px-6 py-5 text-left transition-colors md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1.3fr)_minmax(0,0.4fr)] md:items-center md:gap-6"
                      >
                        <div className="min-w-0">
                          <p className="text-foreground truncate font-semibold">
                            {b.name}
                          </p>
                          <p className="text-muted-foreground truncate text-sm">
                            <span className="font-mono">{b.template_name}</span>
                            {' · '}
                            {t('recipients', { count: b.total_recipients })}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-medium',
                              badge.chip
                            )}
                          >
                            <span
                              className={cn(
                                'size-1.5 rounded-full',
                                badge.dot,
                                b.status === 'sending' && 'animate-pulse'
                              )}
                            />
                            {t(`filters.${b.status}`)}
                          </span>
                          <p className="text-muted-foreground text-xs">
                            {b.status === 'scheduled' && b.scheduled_at
                              ? t('scheduledFor', {
                                  time: when(b.scheduled_at),
                                })
                              : started
                                ? t('startedAt', { time: when(b.created_at) })
                                : t('createdAt', { time: when(b.created_at) })}
                          </p>
                        </div>
                        <div className="space-y-1.5">
                          <div
                            className="bg-muted flex h-1.5 overflow-hidden rounded-full"
                            aria-hidden
                          >
                            <span
                              className="bg-emerald-500"
                              style={{ width: `${readW}%` }}
                            />
                            <span
                              className="bg-sky-500"
                              style={{ width: `${deliveredW}%` }}
                            />
                            <span
                              className="bg-sky-300 dark:bg-sky-800"
                              style={{ width: `${sentW}%` }}
                            />
                            <span
                              className="bg-red-500"
                              style={{ width: `${failedW}%` }}
                            />
                          </div>
                          {started ? (
                            <p className="text-muted-foreground flex flex-wrap gap-x-4 text-xs">
                              <span>
                                <b className="text-foreground font-semibold">
                                  {format.number(b.delivered_count)}
                                </b>{' '}
                                {t('delivered')}
                              </span>
                              <span>
                                <b className="text-foreground font-semibold">
                                  {format.number(b.read_count)}
                                </b>{' '}
                                {t('read')}
                              </span>
                              {b.failed_count > 0 ? (
                                <span>
                                  <b className="font-semibold text-red-500">
                                    {format.number(b.failed_count)}
                                  </b>{' '}
                                  {t('failedLabel')}
                                </span>
                              ) : null}
                            </p>
                          ) : (
                            <p className="text-muted-foreground text-xs">
                              {t('awaitingLaunch')}
                            </p>
                          )}
                        </div>
                        <p className="text-foreground text-right text-lg font-semibold tabular-nums">
                          {format.number(b.replied_count)}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Metric({
  value,
  label,
  fill,
  bar,
}: {
  value: string;
  label: string;
  fill: number;
  bar: string;
}) {
  return (
    <div className="min-w-32 flex-1 space-y-2">
      <p className="flex items-baseline justify-between gap-3">
        <span className="text-foreground text-xl font-semibold tabular-nums">
          {value}
        </span>
        <span className="text-muted-foreground text-sm">{label}</span>
      </p>
      <div className="bg-muted h-1 overflow-hidden rounded-full">
        <div
          className={cn('h-full rounded-full', bar)}
          style={{ width: `${Math.min(fill, 100)}%` }}
        />
      </div>
    </div>
  );
}
