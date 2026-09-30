'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpDown,
  Columns3,
  Lightbulb,
  Loader2,
  Plus,
  Radio,
  Search,
  Trash2,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { useFormatter, useTranslations } from 'next-intl';

import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { LOCK_STALE_MS } from '@/lib/campaigns/advanced';
import {
  ADVANCED_DRAFT_KEY,
  STANDARD_DRAFT_KEY,
  WIZARD_DRAFT_KEY,
  clearDraft,
} from '@/lib/campaigns/draft-storage';
import type { Broadcast } from '@/types';

/** Refresh cadence while anything is live. */
const POLL_MS = 5_000;
const LIVE_WINDOW_MS = 10_000;
const COLUMNS = [
  'status',
  'receivers',
  'pipeline',
  'channels',
  'created',
  'scheduled',
] as const;
type Column = (typeof COLUMNS)[number];
type Filter = 'all' | 'attention' | 'live' | 'completed' | 'drafts';
type Sort = 'created' | 'name' | 'receivers';

interface ChannelLite {
  id: string;
  name: string | null;
  display_phone_number: string | null;
  is_default: boolean;
}

type Row = Broadcast & { updated_at?: string };

/** Sending, but nothing has moved it for a while. */
function isStalled(b: Row, now: number): boolean {
  if (b.status !== 'sending') return false;
  const pending = b.total_recipients - b.sent_count - b.failed_count;
  if (pending <= 0) return false;
  if (b.kind === 'advanced') {
    return (
      !b.delivery_locked_at ||
      now - Date.parse(b.delivery_locked_at) > LOCK_STALE_MS
    );
  }
  // Standard (browser-driven) sends: idle for 10 minutes.
  return now - Date.parse(b.updated_at ?? b.created_at) > 10 * 60_000;
}

// A finished campaign with some failed recipients is done, not a problem
// to act on — failed sends are final and are not retried from here.
const needsAttention = (b: Row, now: number) =>
  b.status === 'paused' || b.status === 'failed' || isStalled(b, now);

const STATUS_CHIP: Record<string, { dot: string; chip: string }> = {
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
  paused: {
    dot: 'bg-amber-500',
    chip: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  stalled: {
    dot: 'bg-amber-500',
    chip: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
};

function readColumns(): Record<Column, boolean> {
  const all = Object.fromEntries(COLUMNS.map((c) => [c, true])) as Record<
    Column,
    boolean
  >;
  try {
    const saved = JSON.parse(
      window.localStorage.getItem('wacrm:campaign-columns') ?? 'null'
    );
    return saved && typeof saved === 'object' ? { ...all, ...saved } : all;
  } catch {
    return all;
  }
}

export default function CampaignsPage() {
  const router = useRouter();
  const t = useTranslations('Campaigns.list');
  const format = useFormatter();
  const canCreate = useCan('send-messages');

  const [rows, setRows] = useState<Row[]>([]);
  const [channels, setChannels] = useState<ChannelLite[]>([]);
  const [rates, setRates] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ by: Sort; desc: boolean }>({
    by: 'created',
    desc: true,
  });
  const [columns, setColumns] = useState<Record<Column, boolean>>(() =>
    typeof window === 'undefined'
      ? (Object.fromEntries(COLUMNS.map((c) => [c, true])) as Record<
          Column,
          boolean
        >)
      : readColumns()
  );
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const db = createClient();
    const { data } = await db
      .from('broadcasts')
      .select('*')
      .order('created_at', { ascending: false });
    const list = (data ?? []) as Row[];
    // Live throughput: sends in the last 10 s, per running campaign — the
    // same window as the campaign page, so both show the same number.
    const since = new Date(Date.now() - LIVE_WINDOW_MS).toISOString();
    const live = list.filter((b) => b.status === 'sending');
    const counts = await Promise.all(
      live.map((b) =>
        db
          .from('broadcast_recipients')
          .select('id', { count: 'exact', head: true })
          .eq('broadcast_id', b.id)
          .gte('sent_at', since)
          .then(
            (r) => [b.id, (r.count ?? 0) / (LIVE_WINDOW_MS / 1000)] as const
          )
      )
    );
    setRows(list);
    setRates(Object.fromEntries(counts));
    setNow(Date.now());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    fetch('/api/whatsapp/channels', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { channels: [] }))
      .then((b) => setChannels((b.channels ?? []) as ChannelLite[]))
      .catch(() => {});
  }, [load]);

  const anyLive = rows.some(
    (b) => b.status === 'sending' || b.status === 'scheduled'
  );
  useEffect(() => {
    if (!anyLive) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [anyLive, load]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        'wacrm:campaign-columns',
        JSON.stringify(columns)
      );
    } catch {
      // per-browser convenience only
    }
  }, [columns]);

  const startNew = (query = '') => {
    clearDraft(STANDARD_DRAFT_KEY, ADVANCED_DRAFT_KEY, WIZARD_DRAFT_KEY);
    router.push(`/broadcasts/new${query}`);
  };
  // Drafts open on their campaign page too, which shows what they'll
  // send with Launch / Schedule / Edit setup.
  const open = (b: Row) => router.push(`/broadcasts/${b.id}`);

  const channelNames = (b: Row): string => {
    const ids =
      b.kind === 'advanced'
        ? (b.config?.channel_ids ?? [])
        : [
            (b.config as { channel_id?: string } | null)?.channel_id ??
              channels.find((c) => c.is_default)?.id,
          ].filter((x): x is string => !!x);
    return ids
      .map((id) => {
        const c = channels.find((x) => x.id === id);
        return c?.name || c?.display_phone_number || '';
      })
      .filter(Boolean)
      .join(', ');
  };
  const templateNames = (b: Row) =>
    b.kind === 'advanced' && b.config?.templates?.length
      ? b.config.templates.map((x) => x.name).join(' · ')
      : b.template_name;

  // ── Derived ────────────────────────────────────────────────────
  const live = rows.filter((b) => b.status === 'sending' && !isStalled(b, now));
  const attention = rows.filter((b) => needsAttention(b, now));
  const draft = rows.find((b) => b.status === 'draft');
  const totals = useMemo(() => {
    let sent = 0,
      delivered = 0,
      read = 0,
      failed = 0;
    for (const b of rows) {
      sent += b.sent_count;
      delivered += b.delivered_count;
      read += b.read_count;
      failed += b.failed_count;
    }
    const scheduled = rows
      .filter((b) => b.status === 'scheduled' && b.scheduled_at)
      .sort(
        (a, b) => Date.parse(a.scheduled_at!) - Date.parse(b.scheduled_at!)
      );
    return {
      sent,
      delivered,
      read,
      failed,
      processed: sent + failed,
      scheduled,
    };
  }, [rows]);
  const pct = (n: number, d: number) =>
    d > 0 ? Math.round((n / d) * 1000) / 10 : 0;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter((b) => {
      const matches =
        filter === 'all' ||
        (filter === 'attention' && needsAttention(b, now)) ||
        (filter === 'live' &&
          (b.status === 'sending' || b.status === 'scheduled')) ||
        (filter === 'completed' &&
          (b.status === 'sent' || b.status === 'failed')) ||
        (filter === 'drafts' && b.status === 'draft');
      if (!matches) return false;
      if (!q) return true;
      return (
        b.name.toLowerCase().includes(q) ||
        templateNames(b).toLowerCase().includes(q)
      );
    });
    const dir = sort.desc ? -1 : 1;
    return list.sort((a, b) => {
      if (sort.by === 'name') return dir * a.name.localeCompare(b.name);
      if (sort.by === 'receivers')
        return dir * (a.total_recipients - b.total_recipients);
      return dir * (Date.parse(a.created_at) - Date.parse(b.created_at));
    });
  }, [rows, filter, search, sort, now]);

  // ── Actions ────────────────────────────────────────────────────
  async function resume(b: Row, scope: 'pending' | 'failed') {
    setActing(b.id);
    try {
      const res = await fetch(`/api/whatsapp/broadcast/${b.id}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(body.error || `HTTP ${res.status}`);
      else toast.success(t('resumeStarted'));
      await load();
    } finally {
      setActing(null);
    }
  }

  async function deletePicked() {
    const ids = [...picked];
    const deletable = rows
      .filter((b) => ids.includes(b.id) && b.status !== 'sending')
      .map((b) => b.id);
    if (deletable.length) {
      const { error } = await createClient()
        .from('broadcasts')
        .delete()
        .in('id', deletable);
      if (error) {
        toast.error(error.message);
        return;
      }
    }
    if (deletable.length < ids.length) toast.warning(t('deleteRunning'));
    else toast.success(t('deleted'));
    setPicked(new Set());
    setConfirmDelete(false);
    await load();
  }

  const statusKey = (b: Row) => (isStalled(b, now) ? 'stalled' : b.status);
  const time = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  const sortBy = (by: Sort) =>
    setSort((s) => ({ by, desc: s.by === by ? !s.desc : true }));
  const allPicked = shown.length > 0 && shown.every((b) => picked.has(b.id));

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-primary size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-foreground text-2xl font-bold tracking-tight sm:text-3xl">
            {t('title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">
            {t('subtitle')}
          </p>
        </div>
        <GatedButton
          canAct={canCreate}
          gateReason="create campaigns"
          onClick={() => startNew()}
          className="bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 text-sm sm:h-11 sm:px-5 sm:text-base"
        >
          <Plus className="size-4" />
          {t('newCampaign')}
        </GatedButton>
      </div>

      {/* Happening now */}
      {live.length > 0 ? (
        <section className="bg-card overflow-hidden rounded-2xl border border-emerald-500/40">
          <div className="border-border flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
            <p className="flex items-center gap-2 font-mono text-xs font-semibold tracking-[0.2em] text-emerald-700 uppercase dark:text-emerald-400">
              <span className="size-2 animate-pulse rounded-full bg-emerald-500" />
              {t('liveTitle', { count: live.length })}
            </p>
            <span className="text-muted-foreground font-mono text-xs">
              {t('autoRefresh')}
            </span>
          </div>
          <div className="divide-border grid divide-y md:grid-cols-2 md:divide-x md:divide-y-0">
            {live.slice(0, 4).map((b) => {
              const done = b.sent_count + b.failed_count;
              const p = b.total_recipients
                ? Math.min(100, Math.floor((done / b.total_recipients) * 100))
                : 0;
              const segments = 40;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => open(b)}
                  className="group hover:bg-muted/30 p-4 text-left sm:p-5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-foreground truncate font-semibold">
                        {b.name}
                      </p>
                      <p className="text-muted-foreground truncate font-mono text-[11px] tracking-[0.15em] uppercase">
                        {templateNames(b)}
                        {channelNames(b) ? ` · ${channelNames(b)}` : ''}
                      </p>
                    </div>
                    <ArrowRight className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-2">
                    <div>
                      <p className="text-primary font-mono text-2xl font-bold tabular-nums sm:text-3xl">
                        {p}%
                      </p>
                      <p className="text-muted-foreground font-mono text-xs">
                        {t('processed', {
                          done: format.number(done),
                          total: format.number(b.total_recipients),
                        })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-foreground font-mono text-lg tabular-nums">
                        {t('rate', { rate: Math.round(rates[b.id] ?? 0) })}
                      </p>
                      <p className="text-muted-foreground font-mono text-xs">
                        {t('delivery', {
                          pct: pct(b.delivered_count, b.sent_count),
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-1" aria-hidden>
                    {Array.from({ length: segments }, (_, i) => (
                      <span
                        key={i}
                        className={cn(
                          'h-1.5 flex-1 rounded-sm',
                          (i + 1) / segments <= p / 100
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

      {/* Needs attention + suggested next */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {attention.length > 0 ? (
          <section className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 sm:p-5">
            <h2 className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300">
              <AlertTriangle className="size-5" />
              {t('attention', { count: attention.length })}
            </h2>
            <ul className="mt-4 space-y-2">
              {attention.slice(0, 3).map((b) => {
                const paused = b.status === 'paused';
                const stalled = isStalled(b, now);
                const kind = paused
                  ? 'paused'
                  : stalled
                    ? 'stalled'
                    : b.status === 'failed'
                      ? 'failed'
                      : 'failures';
                const chip =
                  STATUS_CHIP[
                    paused ? 'paused' : stalled ? 'stalled' : 'failed'
                  ];
                return (
                  <li
                    key={b.id}
                    className="bg-card border-border flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3"
                  >
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
                        chip.chip
                      )}
                    >
                      <span className={cn('size-1.5 rounded-full', chip.dot)} />
                      {t(kind)}
                    </span>
                    <button
                      type="button"
                      onClick={() => open(b)}
                      className="text-foreground min-w-0 flex-1 truncate text-left font-medium hover:underline"
                    >
                      {b.name}
                    </button>
                    <span className="text-muted-foreground text-sm">
                      {paused
                        ? b.config?.paused_reason ||
                          t('pausedReason', {
                            sent: format.number(b.sent_count),
                            total: format.number(b.total_recipients),
                          })
                        : stalled
                          ? t('stalledReason', {
                              done: format.number(
                                b.sent_count + b.failed_count
                              ),
                              total: format.number(b.total_recipients),
                            })
                          : b.config?.stopped_reason
                            ? t('stoppedReason', { reason: b.config.stopped_reason })
                            : t('failedReason')}
                    </span>
                    <button
                      type="button"
                      disabled={acting === b.id}
                      onClick={() =>
                        paused || stalled ? resume(b, 'pending') : open(b)
                      }
                      className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-500/10 disabled:opacity-50 dark:text-amber-300"
                    >
                      {acting === b.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : null}
                      {paused || stalled ? t('resume') : t('view')}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section
          className={cn(
            'flex flex-wrap items-center gap-4 rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 text-sm sm:p-5 sm:text-base',
            attention.length === 0 && 'lg:col-span-2'
          )}
        >
          <Lightbulb className="size-5 shrink-0 text-blue-600" />
          <p className="min-w-0 flex-1 text-blue-900 dark:text-blue-200">
            <span className="font-semibold">{t('suggested')}</span>{' '}
            {draft ? t('suggestDraft', { name: draft.name }) : t('suggestNew')}
          </p>
          <button
            type="button"
            onClick={() => (draft ? open(draft) : startNew())}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            {draft ? t('continueSetup') : t('startNew')}
            <ArrowRight className="size-4" />
          </button>
        </section>
      </div>

      {/* Totals */}
      <section className="border-border bg-card flex flex-wrap items-center gap-x-6 gap-y-4 rounded-2xl border px-3 py-3 sm:gap-x-10 sm:px-4 sm:px-6 sm:py-4 sm:py-5">
        <div className="lg:border-border flex items-center gap-4 pr-6 lg:border-r">
          <span className="flex size-10 items-center justify-center rounded-full bg-blue-500/10 text-blue-600 sm:size-12">
            <Zap className="size-6" />
          </span>
          <div>
            <p className="text-foreground text-2xl font-bold tabular-nums sm:text-3xl">
              {format.number(totals.processed)}
            </p>
            <p className="text-muted-foreground text-sm">{t('allTime')}</p>
          </div>
        </div>
        {(
          [
            [
              t('deliveryRate'),
              `${pct(totals.delivered, totals.sent)}%`,
              pct(totals.delivered, totals.sent),
              'bg-emerald-500',
            ],
            [
              t('readRate'),
              `${pct(totals.read, totals.sent)}%`,
              pct(totals.read, totals.sent),
              'bg-blue-500',
            ],
            [
              t('failedTotal'),
              format.number(totals.failed),
              pct(totals.failed, totals.processed),
              'bg-red-500',
            ],
          ] as const
        ).map(([label, value, width, bar]) => (
          <div key={label} className="min-w-36">
            <p className="flex items-baseline gap-3">
              <span className="text-foreground text-xl font-semibold tabular-nums sm:text-2xl">
                {value}
              </span>
              <span className="text-muted-foreground text-sm">{label}</span>
            </p>
            <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
              <div
                className={cn('h-full rounded-full', bar)}
                style={{ width: `${Math.max(width, width > 0 ? 2 : 0)}%` }}
              />
            </div>
          </div>
        ))}
        <div className="ml-auto text-right">
          <p className="text-foreground text-lg font-semibold sm:text-xl">
            {t('scheduledCount', { count: totals.scheduled.length })}
          </p>
          <p className="text-muted-foreground text-sm">
            {totals.scheduled[0]?.scheduled_at
              ? t('nextAt', { time: time(totals.scheduled[0].scheduled_at) })
              : t('noneScheduled')}
          </p>
        </div>
      </section>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-1 flex-wrap gap-2">
          {(['all', 'attention', 'live', 'completed', 'drafts'] as const).map(
            (f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs transition-colors sm:px-4 sm:py-2 sm:text-sm',
                  filter === f
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border bg-card hover:bg-muted'
                )}
              >
                {t(`filters.${f}`)}
              </button>
            )
          )}
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            className="border-border bg-card focus-visible:border-primary h-10 w-full rounded-lg border pr-3 pl-9 text-sm outline-none"
          />
        </div>
        <Popover>
          <PopoverTrigger className="border-border bg-card hover:bg-muted inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium">
            <Columns3 className="size-4" />
            {t('columns')}
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 gap-0 p-2">
            {COLUMNS.map((c) => (
              <label
                key={c}
                className="hover:bg-muted flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={columns[c]}
                  onChange={(e) =>
                    setColumns({ ...columns, [c]: e.target.checked })
                  }
                  className="accent-primary size-4"
                />
                {t(`col.${c}`)}
              </label>
            ))}
          </PopoverContent>
        </Popover>
      </div>

      {picked.size > 0 ? (
        <div className="border-border bg-card flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2.5 text-sm">
          <span className="font-medium">
            {t('selected', { count: picked.size })}
          </span>
          {confirmDelete ? (
            <>
              <span className="text-red-600 dark:text-red-400">
                {t('confirmDelete', { count: picked.size })}
              </span>
              <button
                type="button"
                onClick={deletePicked}
                className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700"
              >
                {t('delete')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="text-muted-foreground hover:text-foreground px-2"
              >
                {t('cancel')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 px-3 py-1.5 text-red-600 hover:bg-red-500/10 dark:text-red-400"
            >
              <Trash2 className="size-4" />
              {t('delete')}
            </button>
          )}
        </div>
      ) : null}

      {/* Table */}
      <section className="border-border bg-card overflow-hidden rounded-2xl border">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
            <Radio className="text-muted-foreground size-10" />
            <p className="text-foreground font-medium">{t('emptyAll')}</p>
            <p className="text-muted-foreground text-sm">{t('emptyHint')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground border-border border-b text-xs tracking-[0.12em] uppercase">
                <tr>
                  <th className="w-12 px-3 py-3 sm:px-4 sm:py-4">
                    <input
                      type="checkbox"
                      aria-label={t('selectAll')}
                      checked={allPicked}
                      onChange={() =>
                        setPicked(
                          allPicked
                            ? new Set()
                            : new Set(shown.map((b) => b.id))
                        )
                      }
                      className="accent-primary size-4"
                    />
                  </th>
                  <SortHead
                    label={t('col.campaign')}
                    active={sort.by === 'name'}
                    onClick={() => sortBy('name')}
                  />
                  {columns.status ? (
                    <th className="px-3 py-3 text-left font-medium sm:px-4 sm:py-4">
                      {t('col.status')}
                    </th>
                  ) : null}
                  {columns.receivers ? (
                    <SortHead
                      label={t('col.receivers')}
                      active={sort.by === 'receivers'}
                      onClick={() => sortBy('receivers')}
                    />
                  ) : null}
                  {columns.pipeline ? (
                    <th className="min-w-56 px-3 py-3 text-left font-medium sm:px-4 sm:py-4">
                      {t('col.pipeline')}
                    </th>
                  ) : null}
                  {columns.channels ? (
                    <th className="px-3 py-3 text-left font-medium sm:px-4 sm:py-4">
                      {t('col.channels')}
                    </th>
                  ) : null}
                  {columns.created ? (
                    <SortHead
                      label={t('col.created')}
                      active={sort.by === 'created'}
                      onClick={() => sortBy('created')}
                    />
                  ) : null}
                  {columns.scheduled ? (
                    <th className="px-3 py-3 text-left font-medium sm:px-4 sm:py-4">
                      {t('col.scheduled')}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {shown.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="text-muted-foreground px-6 py-12 text-center"
                    >
                      {t('empty')}
                    </td>
                  </tr>
                ) : (
                  shown.map((b) => {
                    const key = statusKey(b);
                    const chip = STATUS_CHIP[key] ?? STATUS_CHIP.draft;
                    const done = b.sent_count + b.failed_count;
                    const total = b.total_recipients || 1;
                    const sentOnly = Math.max(
                      0,
                      b.sent_count - b.delivered_count
                    );
                    return (
                      <tr
                        key={b.id}
                        onClick={() => open(b)}
                        className="hover:bg-muted/30 cursor-pointer"
                      >
                        <td
                          className="px-3 py-3 sm:px-4 sm:py-4"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            aria-label={t('selectRow')}
                            checked={picked.has(b.id)}
                            onChange={() => {
                              const next = new Set(picked);
                              if (next.has(b.id)) next.delete(b.id);
                              else next.add(b.id);
                              setPicked(next);
                            }}
                            className="accent-primary size-4"
                          />
                        </td>
                        <td className="max-w-72 px-3 py-3 sm:px-4 sm:py-4">
                          <p className="text-foreground flex items-center gap-2 font-semibold">
                            <span className="truncate">{b.name}</span>
                            {b.kind === 'advanced' &&
                            b.config?.mode !== 'standard' ? (
                              <span className="border-primary/30 bg-primary/10 text-primary shrink-0 rounded px-1.5 py-px text-[10px] font-medium uppercase">
                                {t('advanced')}
                              </span>
                            ) : null}
                          </p>
                          <p className="text-muted-foreground truncate font-mono text-xs">
                            {templateNames(b)}
                          </p>
                        </td>
                        {columns.status ? (
                          <td className="px-3 py-3 sm:px-4 sm:py-4">
                            <span
                              className={cn(
                                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
                                chip.chip
                              )}
                            >
                              <span
                                className={cn(
                                  'size-1.5 rounded-full',
                                  chip.dot,
                                  key === 'sending' && 'animate-pulse'
                                )}
                              />
                              {t(`status.${key}`)}
                            </span>
                            <p className="text-muted-foreground mt-1 text-xs">
                              {b.status === 'scheduled' && b.scheduled_at
                                ? time(b.scheduled_at)
                                : b.status === 'draft'
                                  ? t('createdAt', { time: time(b.created_at) })
                                  : t('startedAt', {
                                      time: time(b.created_at),
                                    })}
                            </p>
                          </td>
                        ) : null}
                        {columns.receivers ? (
                          <td className="text-foreground px-3 py-3 tabular-nums sm:px-4 sm:py-4">
                            {b.total_recipients
                              ? format.number(b.total_recipients)
                              : '—'}
                          </td>
                        ) : null}
                        {columns.pipeline ? (
                          <td className="px-3 py-3 sm:px-4 sm:py-4">
                            {b.status === 'draft' ||
                            b.status === 'scheduled' ? (
                              <>
                                <div className="bg-muted h-1.5 rounded-full" />
                                <p className="text-muted-foreground mt-1.5 text-xs">
                                  {t('awaiting')}
                                </p>
                              </>
                            ) : (
                              <>
                                <div className="bg-muted flex h-1.5 overflow-hidden rounded-full">
                                  <span
                                    className="bg-emerald-500"
                                    style={{
                                      width: `${(b.delivered_count / total) * 100}%`,
                                    }}
                                  />
                                  <span
                                    className="bg-blue-500"
                                    style={{
                                      width: `${(sentOnly / total) * 100}%`,
                                    }}
                                  />
                                  <span
                                    className="bg-red-500"
                                    style={{
                                      width: `${(b.failed_count / total) * 100}%`,
                                    }}
                                  />
                                </div>
                                <p className="text-muted-foreground mt-1.5 text-xs">
                                  {t('pipelineText', {
                                    pct: Math.floor((done / total) * 100),
                                    delivered: format.number(b.delivered_count),
                                  })}
                                </p>
                              </>
                            )}
                          </td>
                        ) : null}
                        {columns.channels ? (
                          <td
                            className="text-muted-foreground max-w-48 truncate px-3 py-3 sm:px-4 sm:py-4"
                            title={channelNames(b)}
                          >
                            {channelNames(b) || '—'}
                          </td>
                        ) : null}
                        {columns.created ? (
                          <td className="text-muted-foreground px-3 py-3 font-mono text-xs whitespace-nowrap sm:px-4 sm:py-4">
                            {time(b.created_at)}
                          </td>
                        ) : null}
                        {columns.scheduled ? (
                          <td className="text-muted-foreground px-3 py-3 text-xs whitespace-nowrap sm:px-4 sm:py-4">
                            {b.scheduled_at ? time(b.scheduled_at) : '—'}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function SortHead({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <th className="px-3 py-3 text-left font-medium sm:px-4 sm:py-4">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'inline-flex items-center gap-1.5 uppercase',
          active ? 'text-foreground' : 'hover:text-foreground'
        )}
      >
        {label}
        <ArrowUpDown className="size-3.5" />
      </button>
    </th>
  );
}
