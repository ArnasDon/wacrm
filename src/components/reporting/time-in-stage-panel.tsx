'use client';

import { useCallback, useEffect, useState } from 'react';
import { Clock3, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { BarChart, type TooltipProps } from '@/components/tremor/bar-chart';
import type { TimeInStageRow } from '@/lib/reporting/queries';

// ============================================================
// Time in Stage — dónde están atascados los deals HOY.
//
// Corte "ahora mismo": deals activos (status=open) por etapa y
// cuánto llevan en ella (mediana + el que más lleva). La fuente es
// la vista `deal_time_in_stage` (migración 063), que deriva el
// stage_entered_at real de tracking_events (solo transiciones
// from_stage <> to_stage) o el created_at del deal.
//
// El máximo no es ruido: un deal en una etapa 30 días mientras la
// mediana es 2 es un deal dormido, y la operación necesita verlo.
// ============================================================

/** "3d 4h", "2h 10m", "45m" — formato compacto para tabla y ejes. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const rem = mins % 60;
    return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

/** "3 días 4 horas" — formato largo para el tooltip. */
function formatDurationLong(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} seg`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ${mins % 60} min`;
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem > 0 ? `${days} días ${rem} h` : `${days} días`;
}

function TimeStageTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as TimeInStageRow;
  return (
    <div className="rounded-md border border-border bg-popover px-4 py-2 text-sm shadow-md">
      <p className="font-medium text-popover-foreground">{row.stageName}</p>
      <p className="mt-1 text-muted-foreground">
        {row.dealCount} {row.dealCount === 1 ? 'deal activo' : 'deals activos'}
      </p>
      <div className="mt-0.5 space-y-0.5 text-popover-foreground">
        <p className="tabular-nums">Mediana: {formatDurationLong(row.medianSeconds)}</p>
        <p className="tabular-nums text-muted-foreground">
          Máximo: {formatDurationLong(row.maxSeconds)}
        </p>
      </div>
    </div>
  );
}

export function TimeInStagePanel() {
  const [rows, setRows] = useState<TimeInStageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/report/time-in-stage', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { rows: TimeInStageRow[] };
      setRows(json.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <Card className="mt-6">
        <CardContent className="pt-6 text-sm text-red-400">
          No se pudo cargar el tiempo en etapa: {error}
        </CardContent>
      </Card>
    );
  }

  if (rows === null) {
    return (
      <Card className="mt-6">
        <CardContent className="flex h-24 items-center justify-center pt-6">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  const chartData = rows.map((r) => ({
    stageName: r.stageName,
    medianSeconds: r.medianSeconds,
    dealCount: r.dealCount,
    maxSeconds: r.maxSeconds,
  }));
  const total = rows.reduce((acc, r) => acc + r.dealCount, 0);
  const maxMedian = Math.max(...rows.map((r) => r.medianSeconds), 0);

  return (
    <Card className="mt-6">
      <CardContent className="pt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium text-foreground">Pipeline — Time in Stage</p>
          </div>
          <p className="text-xs text-muted-foreground">
            {total} {total === 1 ? 'deal activo' : 'deals activos'} · cuánto llevan en su etapa
            actual
          </p>
        </div>

        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Sin deals activos en el pipeline.
          </p>
        ) : (
          <>
            <div className="mt-2 overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="px-4 py-3 text-left font-medium">Etapa</th>
                    <th className="px-4 py-3 text-right font-medium">Deals</th>
                    <th className="px-4 py-3 text-right font-medium">Mediana</th>
                    <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">
                      Máximo
                    </th>
                    <th className="px-4 py-3 font-medium">Antigüedad relativa</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.stageId}
                      className="border-b border-border last:border-0 hover:bg-muted/50"
                    >
                      <td className="px-4 py-3 font-medium text-foreground">
                        <span className="inline-flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: r.color ?? '#3b82f6' }}
                          />
                          {r.stageName}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.dealCount}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">
                        {formatDuration(r.medianSeconds)}
                      </td>
                      <td className="hidden px-4 py-3 text-right tabular-nums text-muted-foreground sm:table-cell">
                        {formatDuration(r.maxSeconds)}
                      </td>
                      <td className="w-40 px-4 py-3">
                        <div
                          className="h-2 overflow-hidden rounded-full bg-muted"
                          aria-hidden="true"
                        >
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{
                              width: `${maxMedian > 0 ? (r.medianSeconds / maxMedian) * 100 : 0}%`,
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4">
              <p className="mb-1 text-xs text-muted-foreground">
                Mediana de tiempo en etapa por etapa
              </p>
              <BarChart
                data={chartData}
                index="stageName"
                categories={['medianSeconds']}
                valueFormatter={(v) => formatDuration(v)}
                layout="vertical"
                showLegend={false}
                yAxisWidth={100}
                customTooltip={TimeStageTooltip}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}