'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { BarChart3, MessageSquare, Receipt } from 'lucide-react';
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
import { formatCurrency, formatCompactNumber } from '@/lib/currency';
import { format, parseISO } from 'date-fns';

interface UsageResponse {
  configured: boolean;
  window_days: number;
  local: {
    total_outbound: number;
    total_inbound: number;
    by_status: Record<string, number>;
  };
  billing: {
    available: boolean;
    error?: string;
    currency?: string | null;
    total_cost?: number;
    total_billable_volume?: number;
    by_category?: { category: string; volume: number; cost: number }[];
    daily?: { date: string; cost: number }[];
  } | null;
}

const WINDOWS = [7, 30, 90] as const;

const CATEGORY_LABELS: Record<string, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utility',
  AUTHENTICATION: 'Authentication',
  AUTHENTICATION_INTERNATIONAL: 'Authentication (intl.)',
  SERVICE: 'Service',
  MARKETING_LITE: 'Marketing (lite)',
  MARKETING_LITE_DYNAMIC: 'Marketing (lite, dynamic)',
  GROUP_MARKETING: 'Group marketing',
  GROUP_UTILITY: 'Group utility',
  GROUP_SERVICE: 'Group service',
  AI_BOT: 'AI bot',
};

/**
 * Message volume + billing for the account's connected WhatsApp number.
 * Admin-only, mirroring AiUsageCard — billing is billing-class data
 * regardless of provider. Message counts come straight from the local
 * `messages` table; cost comes from Meta's own `pricing_analytics` edge
 * (not an estimate), so the two are shown as separate sections rather
 * than merged into one number.
 */
export function WhatsAppUsageCard() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canView = accountRole ? canEditSettings(accountRole) : false;

  const [days, setDays] = useState<number>(30);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<UsageResponse | null>(null);
  const loadedRef = useRef<string | null>(null);

  const fetchUsage = useCallback(async (windowDays: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/usage?days=${windowDays}`, {
        cache: 'no-store',
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error ?? 'Failed to load usage');
        setData(null);
        return;
      }
      setData(json as UsageResponse);
    } catch {
      toast.error('Failed to load usage');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canView || !accountId) return;
    const key = `${accountId}:${days}`;
    if (loadedRef.current === key) return;
    loadedRef.current = key;
    void fetchUsage(days);
  }, [canView, accountId, days, fetchUsage]);

  if (profileLoading || !canView) return null;

  const currency = data?.billing?.currency ?? undefined;
  const chartData =
    data?.billing?.daily?.map((d) => ({
      day: format(parseISO(d.date), 'MMM d'),
      Cost: Number(d.cost.toFixed(2)),
    })) ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="h-4 w-4 text-primary" /> WhatsApp usage &amp; billing
            </CardTitle>
            <CardDescription>
              Messages sent from this account, and what Meta actually
              billed for them.
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
                  Last {w} days
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading || !data ? (
          <Skeleton className="h-[220px] w-full" />
        ) : !data.configured ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <MessageSquare className="h-8 w-8 opacity-40" />
            <p>WhatsApp isn&apos;t connected for this account yet.</p>
          </div>
        ) : (
          <>
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Messages ({data.window_days} days)
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Sent by us" value={formatCompactNumber(data.local.total_outbound)} />
                <Stat label="Received" value={formatCompactNumber(data.local.total_inbound)} />
                <Stat label="Delivered" value={formatCompactNumber(data.local.by_status.delivered ?? 0)} />
                <Stat label="Failed" value={formatCompactNumber(data.local.by_status.failed ?? 0)} />
              </div>
            </div>

            <div>
              <p className="mb-2 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <Receipt className="h-3 w-3" /> Billed by Meta
              </p>
              {!data.billing?.available ? (
                <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
                  {data.billing?.error ??
                    'Billing data is unavailable — check that the connected WhatsApp access token has business management access.'}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat
                      label="Total cost"
                      value={formatCurrency(data.billing.total_cost ?? 0, currency)}
                    />
                    <Stat
                      label="Billable messages"
                      value={formatCompactNumber(data.billing.total_billable_volume ?? 0)}
                    />
                  </div>

                  {chartData.some((d) => d.Cost > 0) && (
                    <div className="mt-4">
                      <p className="mb-2 text-xs font-medium text-muted-foreground">
                        Cost per day
                      </p>
                      <BarChart
                        data={chartData}
                        index="day"
                        categories={['Cost']}
                        colors={['violet']}
                        valueFormatter={(v) => formatCurrency(v, currency)}
                        showLegend={false}
                        yAxisWidth={56}
                        className="h-[200px]"
                      />
                    </div>
                  )}

                  {data.billing.by_category && data.billing.by_category.length > 0 && (
                    <ul className="mt-4 divide-y divide-border rounded-md border border-border">
                      {data.billing.by_category.map((c) => (
                        <li
                          key={c.category}
                          className="flex items-center justify-between px-3 py-2 text-sm"
                        >
                          <span className="text-foreground">
                            {CATEGORY_LABELS[c.category] ?? c.category}
                          </span>
                          <span className="flex-shrink-0 tabular-nums text-muted-foreground">
                            {formatCompactNumber(c.volume)} msgs ·{' '}
                            {formatCurrency(c.cost, currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {(data.billing.total_billable_volume ?? 0) === 0 && (
                    <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
                      <BarChart3 className="h-3 w-3" /> No billable messages in this window —
                      replies inside a free 24-hour service window don&apos;t cost anything.
                    </p>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}
