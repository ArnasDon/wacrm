'use client'

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

interface DonutSlice {
  name: string
  value: number
  color: string
}

interface KpiDonutChartProps {
  data: DonutSlice[]
  height?: number
  /** Rendered in the donut's empty center — the total is the natural
   *  choice for a temperature-distribution ring. */
  centerLabel?: string
  centerValue?: string | number
}

export function KpiDonutChart({ data, height = 260, centerLabel, centerValue }: KpiDonutChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0)

  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="88%"
            paddingAngle={data.length > 1 ? 3 : 0}
            strokeWidth={0}
          >
            {data.map((slice) => (
              <Cell key={slice.name} fill={slice.color} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, name) => {
              const num = Number(value)
              return [`${num.toLocaleString()} (${total > 0 ? ((num / total) * 100).toFixed(0) : 0}%)`, String(name)]
            }}
            contentStyle={{
              backgroundColor: 'var(--popover)',
              borderColor: 'var(--border)',
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: 'var(--foreground)', fontWeight: 600 }}
            itemStyle={{ color: 'var(--muted-foreground)' }}
          />
        </PieChart>
      </ResponsiveContainer>
      {(centerLabel || centerValue != null) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {centerValue != null && (
            <span className="text-2xl font-bold tabular-nums text-foreground">{centerValue}</span>
          )}
          {centerLabel && <span className="text-xs text-muted-foreground">{centerLabel}</span>}
        </div>
      )}
      <ul className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
        {data.map((slice) => (
          <li key={slice.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
            {slice.name} · <span className="tabular-nums text-foreground">{slice.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
