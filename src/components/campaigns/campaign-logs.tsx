'use client';

import { useMemo, useState } from 'react';
import {
  Check,
  CheckCheck,
  Clock,
  Download,
  Eye,
  MessageSquareReply,
  Search,
  XCircle,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { lastEventAt, parseFailure } from '@/lib/campaigns/metrics';
import type { BroadcastRecipient, RecipientStatus } from '@/types';

type Filter = 'all' | RecipientStatus;

const STATUS_STYLE: Record<
  RecipientStatus,
  { icon: typeof Check; text: string }
> = {
  pending: { icon: Clock, text: 'text-muted-foreground' },
  sent: { icon: Check, text: 'text-blue-600 dark:text-blue-400' },
  delivered: {
    icon: CheckCheck,
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  read: { icon: Eye, text: 'text-sky-600 dark:text-sky-400' },
  replied: {
    icon: MessageSquareReply,
    text: 'text-violet-600 dark:text-violet-400',
  },
  failed: { icon: XCircle, text: 'text-red-600 dark:text-red-400' },
};

const FILTERS: Filter[] = [
  'all',
  'delivered',
  'read',
  'replied',
  'sent',
  'failed',
  'pending',
];
const PAGE = 200;

/**
 * "Logs" tab — one row per recipient with its latest event, status,
 * failure detail and Meta error code. Filter by status, search by phone
 * or name, export as CSV.
 */
export function CampaignLogs({
  recipients,
  onExport,
  channelName,
}: {
  recipients: BroadcastRecipient[];
  onExport: () => void;
  /** Advanced campaigns: adds Channel + Template columns. */
  channelName?: (id?: string | null) => string;
}) {
  const t = useTranslations('Broadcasts.detail.logs');
  const tm = useTranslations('Broadcasts.detail.monitor');
  const tDetail = useTranslations('Broadcasts.detail');
  const tAdv = useTranslations('Broadcasts.detail.advancedInfo');
  const format = useFormatter();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const counts = useMemo(() => {
    const c = { all: recipients.length } as Record<Filter, number>;
    for (const f of FILTERS) if (f !== 'all') c[f] = 0;
    for (const r of recipients) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [recipients]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    return recipients
      .filter((r) => {
        if (filter !== 'all' && r.status !== filter) return false;
        if (!q) return true;
        const name = (r.contact?.name ?? '').toLowerCase();
        const phone = (r.contact?.phone ?? '').replace(/\D/g, '');
        return (
          name.includes(q) || (digits.length > 0 && phone.includes(digits))
        );
      })
      .map((r) => ({ r, at: lastEventAt(r) }))
      .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  }, [recipients, filter, search]);

  const label = (f: Filter) =>
    f === 'all' ? t('all') : f === 'pending' ? t('queued') : tm(f);

  return (
    <section className="border-border bg-card overflow-hidden rounded-xl border">
      <div className="border-border flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
        <div className="flex flex-1 flex-wrap gap-2">
          {FILTERS.map((f) => {
            if (f !== 'all' && counts[f] === 0) return null;
            const active = filter === f;
            const Icon = f === 'all' ? null : STATUS_STYLE[f].icon;
            return (
              <button
                key={f}
                type="button"
                onClick={() => {
                  setFilter(f);
                  setLimit(PAGE);
                }}
                aria-pressed={active}
                className={cn(
                  'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 font-mono text-xs tracking-[0.12em] uppercase transition-colors',
                  active
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border bg-card text-foreground hover:bg-muted'
                )}
              >
                {Icon ? (
                  <Icon
                    className={cn(
                      'size-3.5',
                      !active && STATUS_STYLE[f as RecipientStatus].text
                    )}
                  />
                ) : null}
                {label(f)}
                <span
                  className={cn(
                    'rounded px-1.5 tabular-nums',
                    active ? 'bg-background/20' : 'bg-muted'
                  )}
                >
                  {counts[f]}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1 lg:w-64">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('search')}
              aria-label={t('search')}
              className="border-border bg-background text-foreground placeholder:text-muted-foreground focus-visible:border-ring h-9 w-full rounded-md border pr-3 pl-9 font-mono text-xs outline-none"
            />
          </div>
          <Button variant="outline" onClick={onExport} className="h-9">
            <Download className="size-4" />
            {tDetail('export')}
          </Button>
        </div>
      </div>

      <div className="max-h-[36rem] overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-card text-muted-foreground sticky top-0 font-mono text-[11px] tracking-[0.15em] uppercase">
            <tr className="border-border border-b">
              <th className="px-5 py-3 text-left font-medium">
                {t('columns.contact')}
              </th>
              <th className="px-5 py-3 text-left font-medium">
                {t('columns.timestamp')}
              </th>
              <th className="px-5 py-3 text-left font-medium">
                {t('columns.status')}
              </th>
              {channelName ? (
                <>
                  <th className="hidden px-5 py-3 text-left font-medium lg:table-cell">
                    {tAdv('channel')}
                  </th>
                  <th className="hidden px-5 py-3 text-left font-medium lg:table-cell">
                    {tAdv('template')}
                  </th>
                </>
              ) : null}
              <th className="hidden px-5 py-3 text-left font-medium md:table-cell">
                {t('columns.detail')}
              </th>
              <th className="hidden px-5 py-3 text-left font-medium md:table-cell">
                {t('columns.errorCode')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {rows.slice(0, limit).map(({ r, at }) => {
              const style = STATUS_STYLE[r.status] ?? STATUS_STYLE.pending;
              const Icon = style.icon;
              const failure =
                r.status === 'failed' ? parseFailure(r.error_message) : null;
              return (
                <tr key={r.id} className="hover:bg-muted/40">
                  <td className="px-5 py-3">
                    <p className="text-foreground">
                      {r.contact?.name || t('unknownContact')}
                    </p>
                    <p className="text-muted-foreground font-mono text-xs">
                      {r.contact?.phone ?? '—'}
                    </p>
                  </td>
                  <td className="text-muted-foreground px-5 py-3 font-mono text-xs tabular-nums">
                    {at
                      ? format.dateTime(new Date(at), {
                          dateStyle: 'medium',
                          timeStyle: 'medium',
                        })
                      : '—'}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 font-medium',
                        style.text
                      )}
                    >
                      <Icon className="size-4" />
                      {r.status === 'pending' ? t('queued') : tm(r.status)}
                    </span>
                  </td>
                  {channelName ? (
                    <>
                      <td className="text-foreground hidden px-5 py-3 lg:table-cell">
                        {channelName(r.whatsapp_config_id) || '—'}
                      </td>
                      <td className="text-muted-foreground hidden px-5 py-3 font-mono text-xs lg:table-cell">
                        {r.template_name ?? '—'}
                      </td>
                    </>
                  ) : null}
                  <td
                    className="text-muted-foreground hidden max-w-xs truncate px-5 py-3 md:table-cell"
                    title={r.error_message ?? undefined}
                  >
                    {failure ? failure.title : '—'}
                  </td>
                  <td className="hidden px-5 py-3 font-mono text-xs md:table-cell">
                    {failure?.code != null ? (
                      <span className="text-red-600 dark:text-red-400">
                        {failure.code}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length > limit ? (
          <div className="border-border border-t p-3 text-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLimit((l) => l + PAGE)}
            >
              +{format.number(Math.min(PAGE, rows.length - limit))}
            </Button>
          </div>
        ) : null}
      </div>
      <p className="border-border text-muted-foreground border-t px-5 py-3 font-mono text-[11px]">
        {t('showing', {
          shown: format.number(Math.min(limit, rows.length)),
          total: format.number(rows.length),
        })}
      </p>
    </section>
  );
}
