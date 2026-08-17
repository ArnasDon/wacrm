'use client'

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatBucketLabel, type BucketGranularity } from '@/lib/dashboard/date-utils'
import type { SeriesPoint } from '@/lib/kpis/types'

/** Raw hex, matching the hand-rolled dashboard chart's own convention
 *  (src/components/dashboard/conversations-chart.tsx) rather than
 *  Tremor's Tailwind-class color system — simpler for a one-off
 *  gradient fill, and visually consistent with the rest of the app. */
const PALETTE = {
  emerald: '#10b981',
  violet: '#7c3aed',
  amber: '#f59e0b',
  blue: '#3b82f6',
} as const

export type KpiChartColor = keyof typeof PALETTE

interface KpiLineChartProps {
  data: SeriesPoint[]
  granularity: BucketGranularity
  color?: KpiChartColor
  valueFormatter?: (value: number) => string
  height?: number
}

export function KpiLineChart({
  data,
  granularity,
  color = 'violet',
  valueFormatter = (v) => v.toLocaleString(),
  height = 260,
}: KpiLineChartProps) {
  const hex = PALETTE[color]
  const gradientId = `kpi-gradient-${color}`

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={hex} stopOpacity={0.35} />
            <stop offset="95%" stopColor={hex} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
        <XAxis
          dataKey="key"
          tickFormatter={(key: string) => formatBucketLabel(key, granularity)}
          className="text-xs text-muted-foreground"
          tick={{ fill: 'currentColor' }}
          stroke="currentColor"
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          className="text-xs text-muted-foreground"
          tick={{ fill: 'currentColor' }}
          stroke="currentColor"
          tickLine={false}
          axisLine={false}
          width={40}
          tickFormatter={valueFormatter}
          allowDecimals={false}
        />
        <Tooltip
          formatter={(value) => [valueFormatter(Number(value)), '']}
          labelFormatter={(key) => formatBucketLabel(String(key), granularity)}
          contentStyle={{
            backgroundColor: 'var(--popover)',
            borderColor: 'var(--border)',
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: 'var(--foreground)', fontWeight: 600, marginBottom: 4 }}
          itemStyle={{ color: 'var(--muted-foreground)' }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={hex}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
