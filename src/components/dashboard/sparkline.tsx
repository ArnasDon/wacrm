'use client'

import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts'

export function Sparkline({ values }: { values: (number | null)[] }) {
  const data = values.map((v, i) => ({ i, v }))
  const hasData = values.some((v) => v != null && v > 0)
  return (
    <div className="h-9 w-full" aria-hidden>
      {hasData ? (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 3, right: 2, bottom: 0, left: 2 }}>
            <YAxis hide domain={['dataMin', 'dataMax']} />
            <Area
              type="monotone"
              dataKey="v"
              stroke="var(--primary)"
              strokeWidth={2}
              fill="var(--primary)"
              fillOpacity={0.12}
              connectNulls
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div className="mt-6 h-px w-full bg-border" />
      )}
    </div>
  )
}
