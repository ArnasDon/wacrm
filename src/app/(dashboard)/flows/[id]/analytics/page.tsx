'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Loader2,
  Route,
  Timer,
  Users,
} from 'lucide-react';

import {
  formatAnalyticsDuration,
  formatAnalyticsPercent,
} from '@/components/flows/analytics-view';
import type {
  FlowAnalyticsNode,
  FlowAnalyticsResponse,
} from '@/lib/flows/analytics';

const PERIODS = [7, 30, 90, 365] as const;

export default function FlowAnalyticsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('Flows.analytics');
  const [period, setPeriod] = useState<number>(30);
  const [versionId, setVersionId] = useState('');
  const [data, setData] = useState<FlowAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!params.id) return;
    const controller = new AbortController();
    const to = new Date();
    const from = new Date(to.getTime() - period * 24 * 60 * 60 * 1_000);
    const query = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
    });
    if (versionId) query.set('version_id', versionId);

    void fetch(`/api/flows/${params.id}/analytics?${query}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`analytics:${response.status}`);
        return (await response.json()) as FlowAnalyticsResponse;
      })
      .then(setData)
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
          setError(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [params.id, period, retryNonce, versionId]);

  function retry() {
    setData(null);
    setLoading(true);
    setError(false);
    setRetryNonce((value) => value + 1);
  }

  const totals = useMemo(() => {
    const nodes = data?.nodes ?? [];
    const resolved = nodes.reduce((sum, node) => sum + node.resolved, 0);
    const advanced = nodes.reduce((sum, node) => sum + node.advanced, 0);
    return {
      entries: nodes.reduce((sum, node) => sum + node.entries, 0),
      runs: Math.max(0, ...nodes.map((node) => node.unique_runs)),
      advancement: resolved === 0 ? null : advanced / resolved,
      avgDuration: weightedDuration(nodes),
    };
  }, [data]);

  if (loading && !data) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm"
      >
        <Loader2 className="h-5 w-5 animate-spin" />
        {t('loading')}
      </div>
    );
  }

  if (error && !data) {
    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
      >
        <AlertTriangle className="h-6 w-6 text-red-400" />
        <p className="text-muted-foreground text-sm">{t('loadError')}</p>
        <button
          data-testid="analytics-retry"
          type="button"
          className="bg-primary text-primary-foreground rounded-md px-3 py-2 text-sm font-medium hover:opacity-90"
          onClick={retry}
        >
          {t('retry')}
        </button>
        <button
          type="button"
          className="text-primary text-sm font-medium hover:opacity-80"
          onClick={() => router.push(`/flows/${params.id}`)}
        >
          {t('backToFlow')}
        </button>
      </div>
    );
  }

  if (!data) return null;
  const maxEntries = Math.max(1, ...data.nodes.map((node) => node.entries));
  const hasEntries = data.nodes.some((node) => node.entries > 0);
  const selectedVersion = versionId || data.version.id;

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => router.push(`/flows/${data.flow.id}`)}
            className="text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1 text-xs"
          >
            <ArrowLeft className="h-3 w-3" />
            {data.flow.name}
          </button>
          <h1 className="text-foreground text-xl font-semibold">
            {t('title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('description')}
          </p>
        </div>
        <label className="text-muted-foreground grid gap-1 text-xs">
          {t('versionLabel')}
          <select
            aria-label={t('versionLabel')}
            value={selectedVersion}
            onChange={(event) => {
              setData(null);
              setLoading(true);
              setError(false);
              setVersionId(event.target.value);
            }}
            className="border-border bg-card text-foreground h-9 min-w-36 rounded-md border px-3 text-sm"
          >
            {data.available_versions.map((version) => (
              <option key={version.id} value={version.id}>
                {t('versionOption', { version: version.version })}
                {version.label ? ` · ${version.label}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="text-muted-foreground grid gap-1 text-xs">
          {t('periodLabel')}
          <select
            aria-label={t('periodLabel')}
            value={period}
            onChange={(event) => {
              setData(null);
              setLoading(true);
              setError(false);
              setPeriod(Number(event.target.value));
            }}
            className="border-border bg-card text-foreground h-9 min-w-32 rounded-md border px-3 text-sm"
          >
            {PERIODS.map((days) => (
              <option key={days} value={days}>
                {t('periodDays', { days })}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div
        role="status"
        className="text-muted-foreground rounded-lg border border-sky-500/25 bg-sky-500/5 px-4 py-3 text-xs"
      >
        {t('coverage', {
          date: new Date(data.coverage_started_at).toLocaleDateString(),
          count: data.legacy_attempts_excluded,
        })}
      </div>

      <section
        aria-label={t('summary')}
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <MetricCard
          icon={Route}
          label={t('entries')}
          value={totals.entries.toLocaleString()}
        />
        <MetricCard
          icon={Users}
          label={t('uniqueRuns')}
          value={totals.runs.toLocaleString()}
        />
        <MetricCard
          icon={BarChart3}
          label={t('advanceRate')}
          value={formatAnalyticsPercent(totals.advancement)}
        />
        <MetricCard
          icon={Timer}
          label={t('avgDuration')}
          value={formatAnalyticsDuration(totals.avgDuration)}
        />
      </section>

      <section className="border-border bg-card rounded-xl border p-4">
        <h2 className="text-foreground text-sm font-semibold">
          {t('biggestDropoff')}
        </h2>
        {data.biggest_dropoff ? (
          <p className="text-muted-foreground mt-2 text-sm">
            <code className="text-foreground">
              {data.biggest_dropoff.node_key}
            </code>{' '}
            ·{' '}
            {t('dropoffSummary', {
              count: data.biggest_dropoff.dropoff,
              rate:
                formatAnalyticsPercent(data.biggest_dropoff.dropoff_rate) ||
                '—',
            })}
          </p>
        ) : (
          <p className="text-muted-foreground mt-2 text-sm">{t('noDropoff')}</p>
        )}
      </section>

      {!hasEntries && (
        <div
          data-testid="analytics-empty"
          className="border-border bg-card/50 text-muted-foreground rounded-xl border border-dashed px-6 py-10 text-center text-sm"
        >
          {t('empty')}
        </div>
      )}

      <section className="border-border bg-card overflow-hidden rounded-xl border">
        <div className="border-border border-b px-4 py-3">
          <h2 className="text-foreground text-sm font-semibold">
            {t('funnel')}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                {[
                  'node',
                  'funnel',
                  'entries',
                  'uniqueRuns',
                  'advanceRate',
                  'dropoff',
                  'avgDuration',
                  'processing',
                  'branches',
                ].map((key) => (
                  <th key={key} scope="col" className="px-3 py-2 font-medium">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {data.nodes.map((node) => (
                <NodeRow
                  key={node.node_key}
                  node={node}
                  maxEntries={maxEntries}
                  t={t}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {loading && (
        <div
          role="status"
          aria-live="polite"
          className="border-border bg-card text-muted-foreground fixed right-4 bottom-4 inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs shadow-lg"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('refreshing')}
        </div>
      )}
    </main>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Route;
  label: string;
  value: string;
}) {
  return (
    <div className="border-border bg-card rounded-xl border p-4">
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className="text-foreground mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function NodeRow({
  node,
  maxEntries,
  t,
}: {
  node: FlowAnalyticsNode;
  maxEntries: number;
  t: ReturnType<typeof useTranslations>;
}) {
  const width = `${Math.max(0, Math.min(100, (node.entries / maxEntries) * 100))}%`;
  const branches =
    node.next_nodes.length === 0
      ? '—'
      : node.next_nodes
          .map((branch) => `${branch.node_key} (${branch.count})`)
          .join(', ');
  return (
    <tr>
      <td className="px-3 py-3">
        <code className="text-foreground font-medium">{node.node_key}</code>
        <div className="text-muted-foreground mt-0.5 text-[10px]">
          {node.node_type}
        </div>
      </td>
      <td className="w-44 px-3 py-3">
        <div
          role="img"
          aria-label={t('funnelBarLabel', {
            node: node.node_key,
            count: node.entries,
          })}
          className="bg-muted h-2.5 overflow-hidden rounded-full"
        >
          <div className="bg-primary h-full rounded-full" style={{ width }} />
        </div>
      </td>
      <td className="px-3 py-3 tabular-nums">{node.entries}</td>
      <td className="px-3 py-3 tabular-nums">{node.unique_runs}</td>
      <td className="px-3 py-3 tabular-nums">
        {formatAnalyticsPercent(node.advance_rate)}
      </td>
      <td className="px-3 py-3 tabular-nums">
        {node.dropoff} · {formatAnalyticsPercent(node.dropoff_rate)}
      </td>
      <td className="px-3 py-3 tabular-nums">
        {formatAnalyticsDuration(node.avg_duration_ms)}
      </td>
      <td className="px-3 py-3 tabular-nums">
        {formatAnalyticsDuration(node.avg_processing_ms)}
      </td>
      <td className="text-muted-foreground max-w-56 px-3 py-3">{branches}</td>
    </tr>
  );
}

function weightedDuration(nodes: FlowAnalyticsNode[]): number | null {
  let total = 0;
  let weight = 0;
  for (const node of nodes) {
    if (node.avg_duration_ms === null || node.resolved === 0) continue;
    total += node.avg_duration_ms * node.resolved;
    weight += node.resolved;
  }
  return weight === 0 ? null : total / weight;
}
