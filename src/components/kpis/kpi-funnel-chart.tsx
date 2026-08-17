'use client'

import { Cell, Funnel, FunnelChart, LabelList, ResponsiveContainer, Tooltip } from 'recharts'

interface FunnelStage {
  name: string
  value: number
  color: string
}

interface KpiFunnelChartProps {
  stages: FunnelStage[]
  height?: number
}

/** The sales funnel the 4 KPIs form together: leads generados →
 *  leads calificados → ventas ganadas. A separate, purpose-built
 *  chart rather than reusing the line/donut components — a funnel is
 *  the one visualization that makes the *relationship* between the
 *  three counts legible at a glance (what fraction survives each
 *  stage), which no single KPI card or trend line shows on its own. */
export function KpiFunnelChart({ stages, height = 280 }: KpiFunnelChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <FunnelChart>
        <Tooltip
          formatter={(value, name) => [Number(value).toLocaleString(), String(name)]}
          contentStyle={{
            backgroundColor: 'var(--popover)',
            borderColor: 'var(--border)',
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: 'var(--foreground)', fontWeight: 600 }}
          itemStyle={{ color: 'var(--muted-foreground)' }}
        />
        <Funnel dataKey="value" data={stages} isAnimationActive>
          {stages.map((s) => (
            <Cell key={s.name} fill={s.color} />
          ))}
          <LabelList position="right" dataKey="name" fill="var(--muted-foreground)" stroke="none" fontSize={12} />
          <LabelList position="center" dataKey="value" fill="#fff" stroke="none" fontSize={13} fontWeight={600} />
        </Funnel>
      </FunnelChart>
    </ResponsiveContainer>
  )
}
