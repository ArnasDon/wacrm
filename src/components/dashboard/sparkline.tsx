'use client'

import { cn } from '@/lib/utils'

// Lollipop sparkline: one slim capsule per bucket with a dot at its
// base. The peak bucket glows in the highlight yellow. Long series are
// trimmed to the most recent buckets so each capsule stays readable.
const MAX_BARS = 14

export function Sparkline({ values }: { values: (number | null)[] }) {
  const recent = values.slice(-MAX_BARS)
  const max = Math.max(0, ...recent.map((v) => v ?? 0))
  const hasData = max > 0
  const peakIndex = hasData ? recent.lastIndexOf(max) : -1

  return (
    <div className="flex h-12 w-full items-end justify-between gap-1 pt-1" aria-hidden>
      {recent.map((v, i) => {
        const value = v ?? 0
        // Capped at 85% to leave room for the base dot.
        const h = hasData ? Math.max(8, (value / max) * 85) : 8
        const isPeak = i === peakIndex
        return (
          <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <div
              className={cn(
                'w-1.5 rounded-full transition-[height] duration-500',
                value === 0
                  ? 'hatch bg-foreground/[0.06]'
                  : isPeak
                    ? 'bg-highlight'
                    : 'bg-foreground/80',
              )}
              style={{ height: `${h}%` }}
            />
            <div className={cn('size-1 rounded-full', isPeak ? 'bg-highlight' : 'bg-foreground/30')} />
          </div>
        )
      })}
    </div>
  )
}
