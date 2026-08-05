'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Megaphone, Globe, MousePointerClick, Mail,
  Phone, Trophy, UserX, CalendarRange,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// ============================================================
// Reports — 8 pestañas (DAD §7.6, Item 15).
// Agregados server-side en /api/report/[tab] (agent+); won_at/lost_at
// reales (047) en vez del proxy updated_at.
// ============================================================

type Tab =
  | 'overview' | 'campaigns' | 'channels' | 'ads'
  | 'email' | 'calls' | 'top-leads' | 'lost';

const TABS: { id: Tab; label: string; icon: typeof BarChart3 }[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'campaigns', label: 'Campaigns', icon: Megaphone },
  { id: 'channels', label: 'Channels', icon: Globe },
  { id: 'ads', label: 'Ads', icon: MousePointerClick },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'calls', label: 'Calls', icon: Phone },
  { id: 'top-leads', label: 'Top leads', icon: Trophy },
  { id: 'lost', label: 'Lost', icon: UserX },
];

function last30Days(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 30);
  return { from: from.toISOString(), to: to.toISOString() };
}

interface Overview {
  revenue_won: number; pipeline_value: number; leads: number;
  conversion_rate: number; calls: number; emails_sent: number; emails_delivered: number;
}
interface Row { [key: string]: unknown }

function useReport<T>(tab: Tab) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const range = useMemo(() => last30Days(), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/report/${tab}?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as T);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load');
    } finally {
      setLoading(false);
    }
  }, [tab, range]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  return { data, loading, error, reload: load };
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

export default function ReportsPage() {
  return (
    <div>
      <div className="flex items-center gap-2">
        <BarChart3 className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Reports</h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Pipeline, attribution and activity aggregates — last 30 days.
      </p>

      <Tabs defaultValue="overview" className="mt-6">
        <TabsList className="flex-wrap">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              <t.icon className="mr-1.5 h-4 w-4" /> {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-4"><OverviewTab /></TabsContent>
        <TabsContent value="campaigns" className="mt-4"><TableTab tab="campaigns" columns={['campaign', 'leads', 'deals', 'revenue']} /></TabsContent>
        <TabsContent value="channels" className="mt-4"><TableTab tab="channels" columns={['channel', 'leads', 'revenue']} /></TabsContent>
        <TabsContent value="ads" className="mt-4"><TableTab tab="ads" columns={['click_id', 'click_type', 'leads', 'revenue']} /></TabsContent>
        <TabsContent value="email" className="mt-4"><TableTab tab="email" columns={['status', 'count']} /></TabsContent>
        <TabsContent value="calls" className="mt-4"><TableTab tab="calls" columns={['day', 'count', 'lost', 'completed', 'total_duration']} /></TabsContent>
        <TabsContent value="top-leads" className="mt-4"><TopLeadsTab /></TabsContent>
        <TabsContent value="lost" className="mt-4"><LostTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function LoadingOrError({ loading, error, reload }: { loading: boolean; error: string | null; reload: () => void }) {
  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return (
    <div className="space-y-2">
      <p className="text-sm text-destructive">Failed to load: {error}</p>
      <Button variant="outline" size="sm" onClick={reload}>Retry</Button>
    </div>
  );
  return null;
}

function OverviewTab() {
  const { data, loading, error, reload } = useReport<Overview>('overview');
  const cards = data
    ? [
        { label: 'Revenue won', value: fmtMoney(data.revenue_won) },
        { label: 'Pipeline (open)', value: fmtMoney(data.pipeline_value) },
        { label: 'Leads', value: String(data.leads) },
        { label: 'Conversion', value: `${data.conversion_rate}%` },
        { label: 'Calls', value: String(data.calls) },
        { label: 'Emails sent', value: String(data.emails_sent) },
        { label: 'Emails delivered', value: String(data.emails_delivered) },
      ]
    : [];
  return (
    <div className="space-y-4">
      <LoadingOrError loading={loading} error={error} reload={reload} />
      {data && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {cards.map((c) => (
            <Card key={c.label}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">{c.label}</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-bold">{c.value}</CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function TableTab({ tab, columns }: { tab: Tab; columns: string[] }) {
  const { data, loading, error, reload } = useReport<Row[]>(tab);
  return (
    <div className="space-y-4">
      <LoadingOrError loading={loading} error={error} reload={reload} />
      {data && (
        <Card>
          <CardContent className="pt-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    {columns.map((c) => <th key={c} className="py-2 pr-4 font-medium capitalize">{c.replace(/_/g, ' ')}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.map((row, i) => (
                    <tr key={i} className="border-b last:border-0">
                      {columns.map((c) => (
                        <td key={c} className="py-2 pr-4">
                          {typeof row[c] === 'number' && (c.includes('revenue') || c.includes('duration'))
                            ? fmtMoney(row[c] as number)
                            : String(row[c] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TopLeadsTab() {
  const { data, loading, error, reload } = useReport<Row[]>('top-leads');
  return (
    <div className="space-y-4">
      <LoadingOrError loading={loading} error={error} reload={reload} />
      {data && (
        <div className="space-y-2">
          {data.map((lead, i) => (
            <Card key={String(lead.id ?? i)}>
              <CardContent className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <Badge variant="outline">{String(lead.score ?? 0)}</Badge>
                  <span className="font-medium">{String(lead.name)}</span>
                  {lead.source_channel ? (
                    <Badge variant="outline" className="text-muted-foreground">
                      {String(lead.source_channel)}
                    </Badge>
                  ) : null}
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  {lead.priority ? <Badge>{String(lead.priority)}</Badge> : null}
                  <span>{String(lead.status)}</span>
                  <span>{typeof lead.value === 'number' ? fmtMoney(lead.value) : '—'}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function LostTab() {
  const { data, loading, error, reload } = useReport<Row[]>('lost');
  return (
    <div className="space-y-4">
      <LoadingOrError loading={loading} error={error} reload={reload} />
      {data && (
        <div className="space-y-2">
          {data.map((deal, i) => (
            <Card key={String(deal.id ?? i)}>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{String(deal.name)}</span>
                    {deal.source_channel ? (
                      <Badge variant="outline" className="text-muted-foreground">
                        {String(deal.source_channel)}
                      </Badge>
                    ) : null}
                    {deal.reason ? (
                      <Badge variant="secondary">{String(deal.reason)}</Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Lost {String(deal.lost_at ?? '').slice(0, 10)}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CalendarRange className="h-4 w-4" />
                  <span>{new Intl.DateTimeFormat().format(new Date(String(deal.lost_at)))}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      fetch(`/api/deals/${String(deal.id)}/reactivate`, { method: 'POST' })
                        .then((r) => { if (r.ok) reload(); })
                        .catch(() => {});
                    }}
                  >
                    Reactivate
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
