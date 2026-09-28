'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Broadcast, BroadcastRecipient } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  ChevronRight,
  Download,
  Loader2,
  PlayCircle,
  RotateCcw,
  ScrollText,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useFormatter, useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import {
  averageThroughput,
  currentThroughput,
  etaSeconds,
} from '@/lib/campaigns/metrics';
import { LiveMonitor } from '@/components/campaigns/live-monitor';
import { CampaignAnalytics } from '@/components/campaigns/campaign-analytics';
import { CampaignLogs } from '@/components/campaigns/campaign-logs';
import { AdvancedBreakdown } from '@/components/campaigns/advanced-breakdown';
import { LOCK_STALE_MS } from '@/lib/campaigns/advanced';

type Tab = 'monitor' | 'analytics' | 'logs';
const TABS: { key: Tab; icon: typeof Activity }[] = [
  { key: 'monitor', icon: Activity },
  { key: 'analytics', icon: BarChart3 },
  { key: 'logs', icon: ScrollText },
];

// Refresh cadence while the campaign is sending.
const POLL_INTERVAL_MS = 5_000;

const STATUS_BADGE: Record<Broadcast['status'], string> = {
  sending:
    'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  scheduled:
    'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  draft: 'border-border bg-muted text-muted-foreground',
  sent: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  failed: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300',
};

/**
 * CSV export helper — RFC 4180 quoting. Quote every field so
 * commas/newlines/quotes round-trip cleanly.
 */
function toCsv(rows: string[][]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return rows.map((r) => r.map(escape).join(',')).join('\n');
}

function downloadBlob(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 3725 → "1h 2m"; 95 → "1m 35s". */
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

interface ChannelInfo {
  id: string;
  color: string | null;
  name: string | null;
  display_phone_number: string | null;
  is_default: boolean;
}

export default function BroadcastDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('Broadcasts.detail');
  const tPage = useTranslations('Broadcasts.page');
  const format = useFormatter();
  const broadcastId = params.id as string;

  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [recipients, setRecipients] = useState<BroadcastRecipient[]>([]);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resumingScope, setResumingScope] = useState<
    'pending' | 'failed' | null
  >(null);
  const [now, setNow] = useState(() => Date.now());

  const fetchData = useCallback(async () => {
    try {
      const supabase = createClient();

      const { data: bc, error: bcError } = await supabase
        .from('broadcasts')
        .select('*')
        .eq('id', broadcastId)
        .single();

      if (bcError) throw bcError;
      setBroadcast(bc);

      const { data: recs, error: recsError } = await supabase
        .from('broadcast_recipients')
        .select('*, contact:contacts(*)')
        .eq('broadcast_id', broadcastId)
        .order('created_at', { ascending: false });

      if (recsError) throw recsError;
      setRecipients(recs ?? []);
      setNow(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('notFound'));
    } finally {
      setLoading(false);
    }
  }, [broadcastId, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Standard campaigns go out through the account's default channel;
  // advanced ones through the channels in their config.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/whatsapp/channels', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body) return;
        setChannels((body.channels ?? []) as ChannelInfo[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Live refresh while sending; paused while the tab is hidden.
  const sending = broadcast?.status === 'sending';
  const live = sending || broadcast?.status === 'scheduled';
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void fetchData();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [live, fetchData]);

  // Running campaigns open on the live monitor, finished ones on
  // analytics; `?tab=` keeps the choice across reloads.
  const requestedTab = searchParams.get('tab') as Tab | null;
  const defaultTab: Tab =
    broadcast?.status === 'sent' || broadcast?.status === 'failed'
      ? 'analytics'
      : 'monitor';
  const tab: Tab =
    requestedTab && TABS.some((x) => x.key === requestedTab)
      ? requestedTab
      : defaultTab;
  const selectTab = (next: Tab) => {
    const q = new URLSearchParams(searchParams.toString());
    q.set('tab', next);
    router.replace(`/broadcasts/${broadcastId}?${q.toString()}`, {
      scroll: false,
    });
  };

  const isAdvanced = broadcast?.kind === 'advanced';
  const channelName = (id?: string | null) => {
    const c = channels.find((x) => x.id === id);
    return c ? (c.name ?? c.display_phone_number ?? '') : '';
  };
  // A standard campaign records its channel in config (older ones went
  // through the account default).
  const chosenChannelId = !isAdvanced
    ? (broadcast?.config as { channel_id?: string } | null | undefined)
        ?.channel_id
    : undefined;
  const channel =
    channels.find((c) => c.id === chosenChannelId) ??
    channels.find((c) => c.is_default) ??
    channels[0] ??
    null;

  const pendingCount = useMemo(
    () => recipients.filter((r) => r.status === 'pending').length,
    [recipients]
  );
  const retryableCount = useMemo(
    () => recipients.filter((r) => r.status === 'failed').length,
    [recipients]
  );
  const startedAt = useMemo(() => {
    const times = recipients
      .map((r) => (r.sent_at ? new Date(r.sent_at).getTime() : NaN))
      .filter(Number.isFinite);
    return times.length ? Math.min(...times) : null;
  }, [recipients]);

  function handleExport() {
    if (!broadcast) return;
    const header = [
      t('table.contact'),
      t('table.phone'),
      t('table.status'),
      t('table.sent'),
      t('table.delivered'),
      t('table.read'),
      t('table.error'),
      ...(isAdvanced
        ? [t('advancedInfo.channel'), t('advancedInfo.template')]
        : []),
    ];
    const rows = recipients.map((r) => [
      r.contact?.name ?? '',
      r.contact?.phone ?? '',
      r.status,
      r.sent_at ?? '',
      r.delivered_at ?? '',
      r.read_at ?? '',
      r.error_message ?? '',
      ...(isAdvanced
        ? [channelName(r.whatsapp_config_id), r.template_name ?? '']
        : []),
    ]);
    const csv = toCsv([header, ...rows]);
    const safeName = broadcast.name
      .replace(/[^a-z0-9-_]+/gi, '-')
      .toLowerCase();
    downloadBlob(`campaign-${safeName}-${broadcastId.slice(0, 8)}.csv`, csv);
  }

  /**
   * Hand the leftovers to the server (issue #472).
   *
   * The wizard's send loop lives in the tab that started the campaign,
   * so navigating away strands the rest as 'pending' with the campaign
   * stuck 'sending'. This is the recovery, and the same call retries
   * failed recipients.
   */
  async function handleResume(scope: 'pending' | 'failed') {
    setResumingScope(scope);
    try {
      const res = await fetch(`/api/whatsapp/broadcast/${broadcastId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(
          t('toastResumeFailed', {
            error: payload?.error || `HTTP ${res.status}`,
          })
        );
        return;
      }

      toast.success(
        payload.remaining > 0
          ? t('toastResumeStartedCapped', {
              count: payload.resuming,
              remaining: payload.remaining,
            })
          : t('toastResumeStarted', { count: payload.resuming })
      );
      // Delivery runs server-side after the 202, so the counts here are
      // a snapshot — reload to pick up the first of it.
      await fetchData();
    } catch (err) {
      toast.error(
        t('toastResumeFailed', {
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      );
    } finally {
      setResumingScope(null);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    const supabase = createClient();
    // broadcast_recipients cascades on broadcasts.id (migration 001), so a
    // single delete is sufficient.
    const { error: delErr } = await supabase
      .from('broadcasts')
      .delete()
      .eq('id', broadcastId);
    setDeleting(false);
    if (delErr) {
      toast.error(t('toastFailedDelete', { error: delErr.message }));
      return;
    }
    toast.success(t('toastDeleted'));
    router.push('/broadcasts');
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error || !broadcast) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error ?? t('notFound')}</p>
        <Button variant="outline" onClick={() => router.push('/broadcasts')}>
          {t('backToBroadcasts')}
        </Button>
      </div>
    );
  }

  // A campaign whose tab went away sits in 'sending' with recipients
  // still pending and nothing left to move them. Name that state rather
  // than leaving a permanently pulsing badge.
  // Advanced campaigns are driven server-side; they're stalled only when
  // no runner has held the lock recently (the scheduler restarts them).
  const lockAge = broadcast.delivery_locked_at
    ? now - new Date(broadcast.delivery_locked_at).getTime()
    : Infinity;
  const isStalled =
    broadcast.status === 'sending' &&
    pendingCount > 0 &&
    (!isAdvanced || lockAge > LOCK_STALE_MS);

  // Throughput: live rate over the last minute while sending, otherwise
  // the campaign's average from first to last send.
  const liveRate = sending ? currentThroughput(recipients, now) : 0;
  const rate = sending ? liveRate : averageThroughput(recipients);
  const eta = sending ? etaSeconds(pendingCount, liveRate) : 0;
  const deliveryRate =
    broadcast.sent_count > 0
      ? Math.round((broadcast.delivered_count / broadcast.sent_count) * 1000) /
        10
      : 0;

  const topStats = [
    {
      label: t('top.throughput'),
      value:
        rate != null && rate > 0
          ? t('top.perSecond', {
              rate: rate >= 10 ? Math.round(rate) : Math.round(rate * 10) / 10,
            })
          : t('top.unknown'),
    },
    {
      label: t('top.eta'),
      value:
        broadcast.status === 'sending'
          ? eta != null
            ? formatDuration(eta)
            : t('top.unknown')
          : broadcast.status === 'sent'
            ? t('top.done')
            : t('top.unknown'),
    },
    { label: t('top.deliveryRate'), value: `${deliveryRate}%` },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <button
            type="button"
            onClick={() => router.push('/broadcasts')}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
          >
            <ArrowLeft className="size-4" />
            {t('allCampaigns')}
          </button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-foreground text-2xl font-bold tracking-tight sm:text-3xl">
              {broadcast.name}
            </h1>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-xs font-semibold tracking-[0.2em] uppercase',
                STATUS_BADGE[broadcast.status]
              )}
            >
              <span
                className={cn(
                  'size-1.5 rounded-full bg-current',
                  sending && 'animate-pulse'
                )}
              />
              {tPage(`filters.${broadcast.status}`)}
            </span>
          </div>
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs tracking-[0.15em] uppercase">
            {isAdvanced && broadcast.config ? (
              <>
                <span className="border-primary/40 bg-primary/10 text-primary rounded border px-1.5 py-px">
                  {t('advancedInfo.badge')}
                </span>
                <span
                  title={broadcast.config.templates
                    .map((x) => x.name)
                    .join(' → ')}
                >
                  {t('advancedInfo.templatesCount', {
                    count: broadcast.config.templates.length,
                  })}
                </span>
                <ChevronRight className="size-3" />
                <span
                  title={broadcast.config.channel_ids
                    .map(channelName)
                    .join(', ')}
                >
                  {t('advancedInfo.channelsCount', {
                    count: broadcast.config.channel_ids.length,
                  })}
                </span>
              </>
            ) : (
              <span>{broadcast.template_name}</span>
            )}
            {channel && !isAdvanced ? (
              <>
                <ChevronRight className="size-3" />
                <span>
                  {channel.name}
                  {channel.display_phone_number
                    ? ` · ${channel.display_phone_number}`
                    : ''}
                </span>
              </>
            ) : null}
            <ChevronRight className="size-3" />
            <span>
              {broadcast.status === 'scheduled' && broadcast.scheduled_at
                ? t('advancedInfo.scheduledFor', {
                    time: format.dateTime(new Date(broadcast.scheduled_at), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }),
                  })
                : startedAt
                  ? t('top.started', {
                      time: format.dateTime(new Date(startedAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                    })
                  : t('createdAt', {
                      date: format.dateTime(new Date(broadcast.created_at), {
                        dateStyle: 'medium',
                      }),
                    })}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={handleExport}>
            <Download className="size-4" />
            {t('export')}
          </Button>
          {/* Delete — inline confirm. Mid-send campaigns can't be deleted:
              orphaning in-flight Meta messages would leave the funnel
              inconsistent. */}
          {confirmDelete ? (
            <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm">
              <span className="text-red-600 dark:text-red-300">
                {t('deletePrompt')}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="h-7"
              >
                {t('cancel')}
              </Button>
              <Button
                size="sm"
                onClick={handleDelete}
                disabled={deleting}
                className="h-7 bg-red-600 text-white hover:bg-red-700"
              >
                {deleting ? t('deleting') : t('confirm')}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="icon"
              disabled={broadcast.status === 'sending'}
              onClick={() => setConfirmDelete(true)}
              title={
                broadcast.status === 'sending'
                  ? t('cannotDeleteSending')
                  : t('deleteHover')
              }
              aria-label={t('delete')}
              className="text-red-500 hover:bg-red-500/10 disabled:opacity-40"
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Resume / retry (issue #472) — only when something is outstanding. */}
      {broadcast.status !== 'scheduled' &&
        (isStalled ||
          retryableCount > 0 ||
          (!isAdvanced && pendingCount > 0)) && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="text-sm">
              <p className="text-foreground font-medium">
                {isStalled ? t('resumeStalledTitle') : t('resumeTitle')}
              </p>
              <p className="text-muted-foreground mt-0.5">
                {isStalled
                  ? t('resumeStalledHint', { count: pendingCount })
                  : t('resumeHint', { count: retryableCount })}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {pendingCount > 0 && (
                <Button
                  size="sm"
                  onClick={() => handleResume('pending')}
                  disabled={resumingScope !== null}
                >
                  {resumingScope === 'pending' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <PlayCircle className="h-3.5 w-3.5" />
                  )}
                  {t('resumePending', { count: pendingCount })}
                </Button>
              )}
              {retryableCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleResume('failed')}
                  disabled={resumingScope !== null}
                >
                  {resumingScope === 'failed' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5" />
                  )}
                  {t('retryFailed', { count: retryableCount })}
                </Button>
              )}
            </div>
          </div>
        )}

      {/* Tabs + headline stats */}
      <div className="border-border flex flex-wrap items-end justify-between gap-4 border-b">
        <div className="flex" role="tablist">
          {TABS.map(({ key, icon: Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => selectTab(key)}
                className={cn(
                  '-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-3 font-mono text-xs font-semibold tracking-[0.2em] uppercase transition-colors',
                  active
                    ? 'border-primary text-primary'
                    : 'text-muted-foreground hover:text-foreground border-transparent'
                )}
              >
                <Icon className="size-4" />
                {t(`tabs.${key}`)}
              </button>
            );
          })}
        </div>
        <dl className="flex flex-wrap gap-x-8 gap-y-2 pb-3">
          {topStats.map((s) => (
            <div key={s.label} className="text-right">
              <dt className="text-muted-foreground font-mono text-[11px] tracking-[0.2em] uppercase">
                {s.label}
              </dt>
              <dd className="text-foreground font-mono text-lg tabular-nums">
                {s.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div role="tabpanel">
        {tab === 'monitor' ? (
          <div className="space-y-6">
            <LiveMonitor
              broadcast={broadcast}
              recipients={recipients}
              pendingCount={pendingCount}
              isStalled={isStalled}
            />
            {isAdvanced ? (
              <AdvancedBreakdown
                broadcast={broadcast}
                recipients={recipients}
                channels={channels}
              />
            ) : null}
          </div>
        ) : tab === 'analytics' ? (
          <div className="space-y-6">
            <CampaignAnalytics
              broadcast={broadcast}
              recipients={recipients}
              pendingCount={pendingCount}
            />
            {isAdvanced ? (
              <AdvancedBreakdown
                broadcast={broadcast}
                recipients={recipients}
                channels={channels}
              />
            ) : null}
          </div>
        ) : (
          <CampaignLogs
            recipients={recipients}
            onExport={handleExport}
            channelName={isAdvanced ? channelName : undefined}
          />
        )}
      </div>
    </div>
  );
}
