'use client';

import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import {
  campaignEvents,
  failureReasons,
  type EventKind,
} from '@/lib/campaigns/metrics';
import type { Broadcast, BroadcastRecipient } from '@/types';

const SEGMENTS = 60;

const EVENT_DOT: Record<EventKind, string> = {
  sent: 'bg-blue-500',
  delivered: 'bg-emerald-500',
  read: 'bg-sky-500',
  replied: 'bg-violet-500',
  failed: 'bg-red-500',
};

/**
 * "Live monitor" tab — progress, the per-message lifecycle and a stream
 * of the latest recipient events. All figures come from the campaign
 * row and its recipients; the page refreshes them while sending.
 */
export function LiveMonitor({
  broadcast,
  recipients,
  pendingCount,
  isStalled,
}: {
  broadcast: Broadcast;
  recipients: BroadcastRecipient[];
  pendingCount: number;
  isStalled: boolean;
}) {
  const t = useTranslations('Broadcasts.detail.monitor');
  const format = useFormatter();

  const total = broadcast.total_recipients;
  const processed = broadcast.sent_count + broadcast.failed_count;
  const progress = total > 0 ? Math.min(100, (processed / total) * 100) : 0;
  const topFailure = useMemo(
    () => failureReasons(recipients)[0] ?? null,
    [recipients]
  );
  const events = useMemo(
    () => campaignEvents(recipients).slice(0, 60),
    [recipients]
  );
  const sending = broadcast.status === 'sending';

  const state = isStalled
    ? t('stalled')
    : sending
      ? t('transmitting')
      : processed === 0
        ? t('notStarted')
        : t('complete');

  const stages: { key: string; label: string; value: number; dot: string }[] = [
    {
      key: 'queued',
      label: t('queued'),
      value: pendingCount,
      dot: 'bg-neutral-400',
    },
    {
      key: 'sent',
      label: t('sent'),
      value: broadcast.sent_count,
      dot: 'bg-blue-500',
    },
    {
      key: 'delivered',
      label: t('delivered'),
      value: broadcast.delivered_count,
      dot: 'bg-emerald-500',
    },
    {
      key: 'read',
      label: t('read'),
      value: broadcast.read_count,
      dot: 'bg-sky-500',
    },
  ];

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        {/* Progress */}
        <section className="border-border bg-card rounded-xl border p-6">
          <p className="text-muted-foreground font-mono text-xs tracking-[0.2em] uppercase">
            {t('progress')}
          </p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <p className="text-primary font-mono text-7xl leading-none font-bold tabular-nums">
              {Math.floor(progress)}
              <span className="text-3xl">%</span>
            </p>
            <div className="text-right">
              <p className="text-foreground font-mono text-2xl tabular-nums">
                {format.number(processed)}
                <span className="text-muted-foreground">
                  {' '}
                  / {format.number(total)}
                </span>
              </p>
              <p className="text-muted-foreground font-mono text-sm">
                {t('processed')}
              </p>
            </div>
          </div>
          <div
            className="mt-6 flex gap-1"
            role="progressbar"
            aria-valuenow={Math.floor(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            {Array.from({ length: SEGMENTS }, (_, i) => (
              <span
                key={i}
                className={cn(
                  'h-2.5 flex-1 rounded-sm',
                  (i + 1) / SEGMENTS <= progress / 100 + 1e-9
                    ? 'bg-primary'
                    : 'bg-muted',
                  sending &&
                    (i + 1) / SEGMENTS > progress / 100 &&
                    i / SEGMENTS <= progress / 100 &&
                    'bg-primary/50 animate-pulse'
                )}
              />
            ))}
          </div>
          <div className="text-muted-foreground mt-2 flex justify-between font-mono text-xs">
            <span>0</span>
            <span
              className={cn(isStalled && 'text-amber-600 dark:text-amber-400')}
            >
              {state}
            </span>
            <span>{format.number(total)}</span>
          </div>
        </section>

        {/* Lifecycle */}
        <section className="border-border bg-card rounded-xl border p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground font-mono text-xs tracking-[0.2em] uppercase">
              {t('lifecycle')}
            </p>
            <p className="text-muted-foreground font-mono text-xs">
              {t('lifecycleHint')}
            </p>
          </div>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-stretch">
            {stages.map((s, i) => (
              <div key={s.key} className="flex flex-1 items-center gap-2">
                <div className="border-border bg-background flex-1 rounded-lg border px-4 py-3">
                  <p className="text-muted-foreground flex items-center gap-1.5 font-mono text-[11px] tracking-[0.15em] uppercase">
                    <span className={cn('size-1.5 rounded-full', s.dot)} />
                    {s.label}
                  </p>
                  <p className="text-foreground mt-2 font-mono text-2xl tabular-nums">
                    {format.number(s.value)}
                  </p>
                </div>
                {i < stages.length - 1 ? (
                  <ArrowRight className="text-primary hidden size-4 shrink-0 sm:block" />
                ) : null}
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3">
              <div className="flex items-center justify-between font-mono">
                <span className="text-xs tracking-[0.15em] text-red-600 uppercase dark:text-red-400">
                  {t('failed')}
                </span>
                <span className="text-xl text-red-600 tabular-nums dark:text-red-400">
                  {format.number(broadcast.failed_count)}
                </span>
              </div>
              <p className="text-muted-foreground mt-1 truncate font-mono text-xs">
                {topFailure
                  ? t('failedTop', {
                      reason:
                        topFailure.code != null
                          ? `${topFailure.code} · ${topFailure.title}`
                          : topFailure.title,
                    })
                  : t('failedNone')}
              </p>
            </div>
            <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 px-4 py-3">
              <div className="flex items-center justify-between font-mono">
                <span className="text-xs tracking-[0.15em] text-violet-600 uppercase dark:text-violet-400">
                  {t('replied')}
                </span>
                <span className="text-xl text-violet-600 tabular-nums dark:text-violet-400">
                  {format.number(broadcast.replied_count)}
                </span>
              </div>
              <p className="text-muted-foreground mt-1 font-mono text-xs">
                {t('repliedHint')}
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* Activity stream */}
      <section className="border-border bg-card flex max-h-[34rem] flex-col rounded-xl border">
        <div className="border-border flex items-center justify-between border-b px-5 py-3">
          <p className="text-foreground flex items-center gap-2 font-mono text-xs font-semibold tracking-[0.2em] uppercase">
            <span
              className={cn(
                'size-2 rounded-full',
                sending ? 'animate-pulse bg-emerald-500' : 'bg-neutral-400'
              )}
            />
            {t('stream')}
          </p>
          <span className="text-muted-foreground font-mono text-xs">
            {sending ? t('streamLive') : t('streamIdle')}
          </span>
        </div>
        <ol className="divide-border flex-1 divide-y overflow-y-auto px-5">
          {events.length === 0 ? (
            <li className="text-muted-foreground py-10 text-center font-mono text-xs">
              {t('streamEmpty')}
            </li>
          ) : (
            events.map((e, i) => {
              const name =
                e.recipient.contact?.name || e.recipient.contact?.phone || '—';
              return (
                <li
                  key={`${e.recipient.id}-${e.kind}-${i}`}
                  className="flex items-start gap-3 py-2.5 font-mono text-xs"
                >
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {format.dateTime(new Date(e.at), {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                  <span
                    className={cn(
                      'mt-1 size-1.5 shrink-0 rounded-full',
                      EVENT_DOT[e.kind]
                    )}
                  />
                  <span className="text-foreground min-w-0">
                    {t(`event.${e.kind}`, { name })}
                  </span>
                </li>
              );
            })
          )}
        </ol>
        <p className="border-border text-muted-foreground border-t px-5 py-3 font-mono text-[11px]">
          {t('streamHint')}
        </p>
      </section>
    </div>
  );
}
