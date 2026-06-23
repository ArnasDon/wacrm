"use client"

import { GitBranch } from 'lucide-react'
import type { PipelineDonutData } from '@/lib/dashboard/types'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface PipelineDonutProps {
  data: PipelineDonutData | null
  loading: boolean
}

export function PipelineDonut({ data, loading }: PipelineDonutProps) {
  return (
    <section className="flex h-full flex-col rounded-xl border border-slate-800 bg-slate-900">
      <header className="border-b border-slate-800 px-5 py-4">
        <h2 className="text-sm font-semibold text-white">Valor do Funil</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Negócios abertos por etapa
        </p>
      </header>

      <div className="flex flex-1 flex-col p-5">
        {loading || !data ? (
          <Skeleton className="h-56 w-full" />
        ) : data.stages.length === 0 ? (
          <EmptyState
            icon={GitBranch}
            title="Nenhum negócio aberto ainda"
            hint="Crie negócios em Funis para ver o detalhamento das etapas aqui."
          />
        ) : (
          <>
            <Donut data={data} />
            <ul className="mt-5 space-y-2">
              {data.stages.map((s) => (
                <li key={s.id} className="flex items-center gap-3 text-xs">
                  <span
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                    style={{ background: s.color }}
                    aria-hidden
                  />
                  <span className="flex-1 truncate text-slate-300">{s.name}</span>
                  <span className="text-slate-500 tabular-nums">
                    {s.dealCount} negócio{s.dealCount === 1 ? '' : 's'}
                  </span>
                  <span className="w-20 text-right text-slate-300 tabular-nums">
                    {formatCurrencyShort(s.totalValue)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}

// ------------------------------------------------------------
// SVG ring. 200×200 viewBox, 12px ring width. We draw one <path>
// per stage using an SVG arc from startAngle → endAngle. Gaps
// between segments are implied by a thin slate-900 stroke between
// them for a cleaner look.
// ------------------------------------------------------------
function Donut({ data }: { data: PipelineDonutData }) {
  const size = 200
  const r = 80
  const ringWidth = 18
  const cx = size / 2
  const cy = size / 2

  // Small slices would render as slivers that disappear into stroke
  // rounding. We give each stage a floor share purely for rendering,
  // but keep the labels/legend honest with the actual totals.
  const totalRaw = data.totalValue || 1
  const minFrac = 0.02
  const rawShares = data.stages.map((s) => s.totalValue / totalRaw)
  const floored = rawShares.map((x) => Math.max(x, minFrac))
  const floorSum = floored.reduce((a, b) => a + b, 0)
  const shares = floored.map((x) => x / floorSum)

  // Build a cumulative-offset array, then map stages → arc paths. Using
  // a pre-computed offsets array avoids the Next 16 React Compiler's
  // "Cannot reassign variable after render completes" rule.
  const offsets: number[] = [0]
  for (let i = 0; i < shares.length; i++) offsets.push(offsets[i] + shares[i])
  const segments = data.stages.map((s, i) => {
    const start = offsets[i] * Math.PI * 2 - Math.PI / 2
    const end = offsets[i + 1] * Math.PI * 2 - Math.PI / 2
    return { path: arcPath(cx, cy, r, start, end), color: s.color, id: s.id }
  })

  return (
    <div className="flex items-center justify-center">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-48 w-48" role="img" aria-label="Valor do funil por etapa">
        {/* background ring */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgb(30 41 59)" strokeWidth={ringWidth} />
        {segments.map((seg) => (
          <path
            key={seg.id}
            d={seg.path}
            fill="none"
            stroke={seg.color}
            strokeWidth={ringWidth}
            strokeLinecap="butt"
          />
        ))}
        {/* center label */}
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          className="fill-slate-500 text-[11px]"
        >
          Total
        </text>
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          className="fill-white text-[18px] font-semibold tabular-nums"
        >
          {formatCurrencyShort(data.totalValue)}
        </text>
      </svg>
    </div>
  )
}

function arcPath(cx: number, cy: number, r: number, startRad: number, endRad: number): string {
  const x1 = cx + r * Math.cos(startRad)
  const y1 = cy + r * Math.sin(startRad)
  const x2 = cx + r * Math.cos(endRad)
  const y2 = cy + r * Math.sin(endRad)
  const largeArc = endRad - startRad > Math.PI ? 1 : 0
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`
}

function formatCurrencyShort(v: number): string {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(1)}k`
  return `R$ ${v.toFixed(0)}`
}
