'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  MousePointerClick,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  Loader2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  GROUP_BY_OPTIONS,
  type AcquisitionReport,
  type AcquisitionRow,
  type FunnelStep,
  type GroupBy,
} from '@/lib/reporting/acquisition';

// ============================================================
// /reports — Adquisición. UNA página, sin pestañas.
//
// Las ocho pestañas eran una tabla de inventario técnico convertida en
// interfaz: Campañas, Canales y Ads eran el mismo informe con distinto
// GROUP BY, y eso es un desplegable. Email y Llamadas son actividad, no
// adquisición, y viven en /dashboard. Top leads vive en la Cola de Hoy y
// Perdidos en el pipeline, filtrado por las ramas terminales.
// ============================================================

const RANGES = [
  { key: '7d', label: '7 días', days: 7 },
  { key: '30d', label: '30 días', days: 30 },
  { key: '90d', label: '90 días', days: 90 },
] as const;

function rangeFor(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - days);
  return { from: from.toISOString(), to: to.toISOString() };
}

const money = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });

/** Variación frente al periodo anterior. Un número sin referencia no informa. */
function Delta({ now, before, invert = false }: { now: number; before: number; invert?: boolean }) {
  if (before === 0) {
    return <span className="text-xs text-muted-foreground">sin referencia</span>;
  }
  const pct = Math.round(((now - before) / before) * 1000) / 10;
  if (pct === 0) return <span className="text-xs text-muted-foreground">igual</span>;
  // `invert`: en Perdidos, subir es malo.
  const good = invert ? pct < 0 : pct > 0;
  const Icon = pct > 0 ? TrendingUp : TrendingDown;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${
        good ? 'text-emerald-500' : 'text-red-400'
      }`}
    >
      <Icon className="h-3 w-3" />
      {Math.abs(pct)}%
    </span>
  );
}

function Kpi({
  label,
  value,
  now,
  before,
  invert,
}: {
  label: string;
  value: string;
  now: number;
  before: number;
  invert?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</p>
        <div className="mt-1">
          <Delta now={now} before={before} invert={invert} />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * El embudo: Visitas → Leads → Contactados → Ganados.
 *
 * Los `page_view` llevaban desde la migración 047 guardándose sin que
 * ninguna pantalla los leyera. La primera columna es lo que convierte al
 * resto en un embudo y no en cuatro cifras sueltas: sin denominador, «12
 * leads» no dice si la landing va bien o mal.
 *
 * Lo que se mira aquí es la CAÍDA, no los totales — por eso el porcentaje
 * entre peldaños tiene más peso visual que el acumulado, y por eso hay una
 * línea explícita de cuántos se quedan por el camino en cada escalón.
 */
function Funnel({ steps }: { steps: FunnelStep[] }) {
  const top = steps[0]?.count ?? 0;
  if (steps.length === 0) return null;

  return (
    <Card className="mt-6">
      <CardContent className="pt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-foreground">Embudo</p>
          <p className="text-xs text-muted-foreground">
            Porcentajes sobre {steps[0].label.toLowerCase()}
          </p>
        </div>

        <div className="mt-4 space-y-1">
          {steps.map((step, i) => {
            const next = steps[i + 1];
            // Sin Math.max un pipeline con las etapas reordenadas a mano
            // podría dar un peldaño mayor que el anterior y enseñar una
            // pérdida negativa, que no significa nada para quien lo lee.
            const dropped = next ? Math.max(0, step.count - next.count) : 0;

            return (
              <div key={step.key}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-foreground">{step.label}</span>
                  <span className="flex items-baseline gap-3">
                    <span className="font-semibold tabular-nums text-foreground">
                      {step.count.toLocaleString()}
                    </span>
                    <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">
                      {step.fromTop}%
                    </span>
                  </span>
                </div>

                <div
                  className="mt-1 h-2 overflow-hidden rounded-full bg-muted"
                  aria-hidden="true"
                >
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${top > 0 ? (step.count / top) * 100 : 0}%` }}
                  />
                </div>

                {next && (
                  <p className="py-1.5 pl-3 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {next.fromPrev}%
                    </span>{' '}
                    sigue a {next.label.toLowerCase()}
                    {dropped > 0 && <> · se quedan {dropped.toLocaleString()}</>}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function DetailPanel({ row }: { row: AcquisitionRow }) {
  const utmEntries = Object.entries(row.detail.utm);
  const clickEntries = Object.entries(row.detail.clickIds);
  return (
    <div className="grid gap-4 bg-muted/40 px-4 py-4 text-sm md:grid-cols-3">
      <div>
        <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">UTM</p>
        {utmEntries.length === 0 ? (
          <p className="text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-0.5">
            {utmEntries.map(([k, vs]) => (
              <li key={k} className="text-foreground">
                <span className="text-muted-foreground">{k}:</span> {vs.join(', ')}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Click IDs</p>
        {clickEntries.length === 0 ? (
          <p className="text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-0.5">
            {clickEntries.map(([k, n]) => (
              <li key={k} className="text-foreground">
                <span className="text-muted-foreground">{k}:</span> {n}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Landings</p>
        {row.detail.landings.length === 0 ? (
          <p className="text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-0.5">
            {row.detail.landings.map((l) => (
              <li key={l} className="text-foreground">
                {l}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const [rangeKey, setRangeKey] = useState<(typeof RANGES)[number]['key']>('30d');
  const [groupBy, setGroupBy] = useState<GroupBy>('channel');
  const [data, setData] = useState<AcquisitionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const range = useMemo(
    () => rangeFor(RANGES.find((r) => r.key === rangeKey)!.days),
    [rangeKey],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ from: range.from, to: range.to, group_by: groupBy });
      const res = await fetch(`/api/report/acquisition?${qs}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as AcquisitionReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar');
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, groupBy]);

  useEffect(() => {
    load();
  }, [load]);

  const groupLabel = GROUP_BY_OPTIONS.find((o) => o.key === groupBy)?.label ?? 'Canal';

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <MousePointerClick className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Adquisición</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            De dónde vienen los leads que valen. Todo comparado con el periodo anterior.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-muted-foreground" />
          {RANGES.map((r) => (
            <Button
              key={r.key}
              size="sm"
              variant={r.key === rangeKey ? 'default' : 'outline'}
              onClick={() => setRangeKey(r.key)}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-red-400">{error}</p>
          <Button variant="outline" className="mt-3" onClick={load}>
            Reintentar
          </Button>
        </div>
      )}

      {loading && !data && (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {data && (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Leads"
              value={String(data.totals.leads)}
              now={data.totals.leads}
              before={data.previous.leads}
            />
            <Kpi
              label="Ganados"
              value={String(data.totals.won)}
              now={data.totals.won}
              before={data.previous.won}
            />
            <Kpi
              label="Perdidos"
              value={String(data.totals.lost)}
              now={data.totals.lost}
              before={data.previous.lost}
              invert
            />
            <Kpi
              label="Ingreso"
              value={money(data.totals.revenue)}
              now={data.totals.revenue}
              before={data.previous.revenue}
            />
          </div>

          <Funnel steps={data.funnel} />

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Agrupar por</span>
            <select
              value={groupBy}
              onChange={(e) => {
                setGroupBy(e.target.value as GroupBy);
                setExpanded(null);
              }}
              className="rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              {GROUP_BY_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="px-4 py-3 text-left font-medium">{groupLabel}</th>
                  <th className="px-4 py-3 text-right font-medium">Leads</th>
                  <th className="px-4 py-3 text-right font-medium">Ganados</th>
                  <th className="px-4 py-3 text-right font-medium">Perdidos</th>
                  <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">En curso</th>
                  <th className="hidden px-4 py-3 text-right font-medium md:table-cell">Ingreso</th>
                  <th className="px-4 py-3 text-right font-medium text-foreground">Por lead</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                      Sin leads en este periodo.
                    </td>
                  </tr>
                )}
                {data.rows.map((row) => {
                  const open = expanded === row.group;
                  return (
                    // La `key` va en el Fragment, no en el <tr>: una fila puede
                    // renderizar dos hermanos (la fila y su detalle) y React
                    // necesita la clave en la raíz de cada elemento de la lista.
                    <Fragment key={row.group}>
                      <tr
                        className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50"
                        onClick={() => setExpanded(open ? null : row.group)}
                      >
                        <td className="px-4 py-3 font-medium text-foreground">
                          <span className="inline-flex items-center gap-1.5">
                            {open ? (
                              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                            {row.group}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{row.leads}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-emerald-500">
                          {row.won}
                        </td>
                        <td
                          className="px-4 py-3 text-right tabular-nums text-red-400"
                          title={`Desistió: ${row.lostBreakdown.declined} · No contestó / largo plazo: ${row.lostBreakdown.unreachable}`}
                        >
                          {row.lost}
                          {row.lost > 0 && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              ({row.lostBreakdown.declined}/{row.lostBreakdown.unreachable})
                            </span>
                          )}
                        </td>
                        <td className="hidden px-4 py-3 text-right tabular-nums text-muted-foreground sm:table-cell">
                          {row.open}
                        </td>
                        <td className="hidden px-4 py-3 text-right tabular-nums md:table-cell">
                          {money(row.revenue)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">
                          {money(row.perLead)}
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-b border-border">
                          <td colSpan={7} className="p-0">
                            <DetailPanel row={row} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            En Perdidos, el desglose es (desistió / no contestó o largo plazo). No es lo mismo un
            lead que dijo que no que uno que nunca contestó: el segundo puede ser un problema de tu
            tiempo de respuesta, no del canal.
          </p>
        </>
      )}
    </div>
  );
}
