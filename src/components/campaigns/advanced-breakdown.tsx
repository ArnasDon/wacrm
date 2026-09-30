'use client';

import { useMemo } from 'react';
import { Ban, GitBranch } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import { templateKey } from '@/lib/campaigns/advanced';
import type { Broadcast, BroadcastRecipient } from '@/types';

export interface BreakdownChannel {
  id: string;
  name: string | null;
  display_phone_number: string | null;
  color?: string | null;
}

const DELIVERED = new Set(['sent', 'delivered', 'read', 'replied']);

/**
 * Advanced campaigns: how much each channel carried, which template it
 * is on now, and which templates Meta stopped (with the reason).
 */
export function AdvancedBreakdown({
  broadcast,
  recipients,
  channels,
}: {
  broadcast: Broadcast;
  recipients: BroadcastRecipient[];
  channels: BreakdownChannel[];
}) {
  const t = useTranslations('Broadcasts.detail.advancedInfo');
  const format = useFormatter();
  // A draft (or an older row) may carry no channels / templates yet.
  const raw = broadcast.config;
  const config = useMemo(
    () =>
      raw
        ? {
            ...raw,
            channel_ids: raw.channel_ids ?? [],
            templates: raw.templates ?? [],
          }
        : null,
    [raw]
  );

  const rows = useMemo(() => {
    if (!config) return [];
    return config.channel_ids.map((id) => {
      const ch = channels.find((c) => c.id === id);
      let sent = 0;
      let failed = 0;
      for (const r of recipients) {
        if (r.whatsapp_config_id !== id) continue;
        if (DELIVERED.has(r.status)) sent++;
        else if (r.status === 'failed') failed++;
      }
      const exhausted = config.exhausted?.[id] ?? {};
      const current =
        config.templates.find((ref) => !(templateKey(ref) in exhausted)) ??
        null;
      return { id, ch, sent, failed, exhausted, current };
    });
  }, [config, channels, recipients]);

  const perTemplate = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of recipients) {
      if (r.template_name && DELIVERED.has(r.status))
        m.set(r.template_name, (m.get(r.template_name) ?? 0) + 1);
    }
    return m;
  }, [recipients]);

  if (!config) return null;
  const max = Math.max(1, ...rows.map((r) => r.sent + r.failed));

  return (
    <section className="border-border bg-card rounded-xl border">
      <div className="border-border border-b px-5 py-3">
        <p className="text-foreground font-mono text-xs font-semibold tracking-[0.2em] uppercase">
          {t('breakdown')}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {t('breakdownHint')}
        </p>
      </div>
      <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <ul className="space-y-4">
          {rows.map(({ id, ch, sent, failed, exhausted, current }) => (
            <li key={id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-foreground flex min-w-0 items-center gap-2 text-sm font-medium">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: ch?.color || '#25D366' }}
                  />
                  <span className="truncate">
                    {ch
                      ? ch.name || ch.display_phone_number
                      : t('unknownChannel')}
                  </span>
                  {ch?.display_phone_number && ch.name ? (
                    <span className="text-muted-foreground font-mono text-xs font-normal">
                      {ch.display_phone_number}
                    </span>
                  ) : null}
                </p>
                <p className="text-muted-foreground font-mono text-xs tabular-nums">
                  <span className="text-foreground">{format.number(sent)}</span>{' '}
                  {t('sent').toLowerCase()}
                  {failed > 0 ? (
                    <span className="text-red-600 dark:text-red-400">
                      {' '}
                      · {format.number(failed)} {t('failed').toLowerCase()}
                    </span>
                  ) : null}
                </p>
              </div>
              <div
                className="bg-muted mt-2 flex h-2 overflow-hidden rounded-full"
                aria-hidden
              >
                <span
                  className="bg-primary"
                  style={{ width: `${(sent / max) * 100}%` }}
                />
                <span
                  className="bg-red-500"
                  style={{ width: `${(failed / max) * 100}%` }}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">{t('current')}:</span>
                {current ? (
                  <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 font-mono">
                    {current.name}
                  </span>
                ) : (
                  <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-red-600 dark:text-red-400">
                    {t('noneLeft')}
                  </span>
                )}
                {Object.entries(exhausted).map(([key, reason]) => (
                  <span
                    key={key}
                    title={reason}
                    className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-amber-700 line-through decoration-amber-700/50 dark:text-amber-300"
                  >
                    <Ban className="size-3" />
                    {key.split(':')[0]}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>

        <div>
          <p className="text-muted-foreground mb-2 flex items-center gap-1.5 font-mono text-[11px] tracking-[0.15em] uppercase">
            <GitBranch className="size-3.5" />
            {t('template')}
          </p>
          <ol className="space-y-2">
            {config.templates.map((ref, i) => {
              const droppedEverywhere =
                config.channel_ids.length > 0 &&
                config.channel_ids.every(
                  (id) => templateKey(ref) in (config.exhausted?.[id] ?? {})
                );
              return (
                <li
                  key={templateKey(ref)}
                  className="border-border bg-background flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                >
                  <span
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-[11px]',
                      i === 0
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-foreground'
                    )}
                  >
                    {i + 1}
                  </span>
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      droppedEverywhere
                        ? 'text-muted-foreground line-through'
                        : 'text-foreground'
                    )}
                  >
                    {ref.name}
                  </span>
                  {droppedEverywhere ? (
                    <span className="text-xs text-amber-700 dark:text-amber-300">
                      {t('dropped')}
                    </span>
                  ) : null}
                  <span className="text-muted-foreground font-mono text-xs tabular-nums">
                    {format.number(perTemplate.get(ref.name) ?? 0)}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
