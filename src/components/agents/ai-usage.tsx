'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { BarChart3, Bot, PencilLine } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/dashboard/skeleton';
import { BarChart } from '@/components/tremor/bar-chart';
import { formatCompactNumber } from '@/lib/currency';
import { format, parseISO } from 'date-fns';

interface UsageResponse {
  window_days: number;
  truncated: boolean;
  totals: {
    calls: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  by_mode: {
    auto_reply: { calls: number; tokens: number };
    draft: { calls: number; tokens: number };
  };
  by_model: {
    model: string;
    provider: string;
    calls: number;
    tokens: number;
  }[];
  daily: { date: string; tokens: number; calls: number }[];
}

const WINDOWS = [7, 30, 90] as const;

/**
 * Token-spend dashboard for the account's BYO key. Admin-only (spend is
 * billing-class), mirroring the `ai_usage_log` SELECT policy and the
 * `GET /api/ai/usage` route. Renders nothing for non-admins.
 */
export function AiUsageCard() {
  const t = useTranslations('AiUsage');
  const { accountId, accountRole, profileLoading } = useAuth();
  const canView = accountRole ? canEditSettings(accountRole) : false;

  const [days, setDays] = useState<number>(30);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<UsageResponse | null>(null);
  const loadedRef = useRef<string | null>(null);

  const fetchUsage = useCallback(async (windowDays: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ai/usage?days=${windowDays}`, {
        cache: 'no-store',
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error ?? t('loadFailed'));
        setData(null);
        return;
      }
      setData(json as UsageResponse);
    } catch {
      toast.error(t('loadFailed'));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!canView || !accountId) return;
    // Refetch on account switch or window change.
    const key = `${accountId}:${days}`;
    if (loadedRef.current === key) return;
    loadedRef.current = key;
    void fetchUsage(days);
  }, [canView, accountId, days, fetchUsage]);

  if (profileLoading || !canView) return null;

  const chartData =
    data?.daily.map((d) => ({ day: format(parseISO(d.date), 'MMM d'), Tokens: d.tokens })) ??
    [];
  const hasSpend = (data?.totals.total_tokens ?? 0) > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-primary" /> {t('title')}
            </CardTitle>
            <CardDescription>
              {t('description')}
            </CardDescription>
          </div>
          <Select
            value={String(days)}
            onValueChange={(v) => setDays(Number(v))}
          >
            <SelectTrigger className="w-32 flex-shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOWS.map((w) => (
                <SelectItem key={w} value={String(w)}>
                  {t('lastDays', { days: w })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading || !data ? (
          <Skeleton className="h-[220px] w-full" />
        ) : !hasSpend ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <BarChart3 className="h-8 w-8 opacity-40" />
            <p>{t('emptyTitle', { days: data.window_days })}</p>
            <p className="text-xs">
              {t('emptyDesc')}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label={t('statTotalTokens')} value={formatCompactNumber(data.totals.total_tokens)} />
              <Stat label={t('statLlmCalls')} value={String(data.totals.calls)} />
              <Stat
                label={t('statAutoReply')}
                value={formatCompactNumber(data.by_mode.auto_reply.tokens)}
                icon={Bot}
              />
              <Stat
                label={t('statDrafts')}
                value={formatCompactNumber(data.by_mode.draft.tokens)}
                icon={PencilLine}
              />
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                {t('tokensPerDay')}
              </p>
              <BarChart
                data={chartData}
                index="day"
                categories={['Tokens']}
                colors={['violet']}
                valueFormatter={(v) => formatCompactNumber(v)}
                showLegend={false}
                yAxisWidth={48}
                className="h-[200px]"
              />
            </div>

            {data.by_model.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  {t('byModel')}
                </p>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {data.by_model.map((m) => (
                    <li
                      key={`${m.provider}:${m.model}`}
                      className="flex items-center justify-between px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 truncate">
                        <span className="text-foreground">{m.model}</span>{' '}
                        <span className="text-xs text-muted-foreground">
                          ({m.provider})
                        </span>
                      </span>
                      <span className="flex-shrink-0 tabular-nums text-muted-foreground">
                        {t('modelCalls', {
                          tokens: formatCompactNumber(m.tokens),
                          calls: m.calls,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {data.truncated && (
              <p className="text-xs text-muted-foreground">
                {t('truncatedNotice')}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: typeof Bot;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}
