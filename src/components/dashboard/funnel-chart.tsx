'use client';

// §13's funnel: REACH -> JOIN -> ENGAGE -> PRODUCT INTEREST -> LEAD ->
// BA CONTACT -> TRIAL -> PURCHASE -> REPEAT, computed from real DB
// rows (`src/lib/dashboard/rimula-analytics.ts::loadFunnelMetrics`).
// Uses the vendored Tremor `BarChart` (already wraps `recharts`, per
// §4's "chart with recharts" requirement) in vertical/horizontal-bars
// layout — a natural fit for an ordered, decreasing-magnitude funnel.
//
// A stage whose `value` is `null` (currently only REPEAT — no order/
// purchase-history table exists to detect a second conversion) is
// never plotted as a zero-height bar, which would look identical to a
// real zero and misrepresent the data (§2/§13: never fabricate,
// render "Unavailable" explicitly instead).

import { TrendingDown } from 'lucide-react';
import type { FunnelMetrics, FunnelStageKey } from '@/lib/dashboard/types';
import { BarChart } from '@/components/tremor/bar-chart';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';

import { useTranslations } from 'next-intl';

interface FunnelChartProps {
  data: FunnelMetrics | null;
  loading: boolean;
}

const STAGE_ORDER: FunnelStageKey[] = [
  'reach',
  'join',
  'engage',
  'productInterest',
  'lead',
  'baContact',
  'trial',
  'purchase',
  'repeat',
];

const CATEGORY = 'Count';

export function FunnelChart({ data, loading }: FunnelChartProps) {
  const t = useTranslations('Dashboard.funnelChart');

  const byKey = new Map((data?.stages ?? []).map((s) => [s.key, s.value]));
  const unavailable = STAGE_ORDER.filter(
    (k) => byKey.has(k) && byKey.get(k) === null
  );
  const chartData = STAGE_ORDER.filter((k) => byKey.get(k) !== null).map(
    (k) => ({
      stage: t(`stages.${k}`),
      [CATEGORY]: byKey.get(k) ?? 0,
    })
  );
  const hasAnyData = chartData.some((r) => (r[CATEGORY] as number) > 0);

  return (
    <section className="border-border bg-card rounded-xl border">
      <header className="border-border border-b px-5 py-4">
        <h2 className="text-foreground text-sm font-semibold">{t('title')}</h2>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {t('description')}
        </p>
      </header>

      <div className="p-5">
        {loading || !data ? (
          <Skeleton className="h-[360px] w-full" />
        ) : !hasAnyData ? (
          <EmptyState
            icon={TrendingDown}
            title={t('noData')}
            hint={t('noDataHint')}
          />
        ) : (
          <BarChart
            data={chartData}
            index="stage"
            categories={[CATEGORY]}
            // Tremor's palette has no literal "red" — 'amber' is the
            // closest brand-appropriate stand-in for Rimula Gold.
            colors={['amber']}
            layout="vertical"
            showLegend={false}
            yAxisWidth={128}
            className="h-[360px]"
          />
        )}

        {unavailable.length > 0 && (
          <p className="text-muted-foreground mt-4 text-xs">
            {t('unavailableStages', {
              stages: unavailable.map((k) => t(`stages.${k}`)).join(', '),
            })}
            : {t('unavailableReason')}
          </p>
        )}
      </div>
    </section>
  );
}
