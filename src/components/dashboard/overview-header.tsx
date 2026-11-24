'use client'

import { useRouter } from 'next/navigation'
import {
  Briefcase,
  CheckCheck,
  ChevronDown,
  MessagesSquare,
  Plus,
  Radio,
  Trophy,
  UserPlus,
  Zap,
} from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import type { ComponentType } from 'react'

import { buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  OVERVIEW_RANGES,
  minutesBetween,
  needsSetup,
  ratio,
  type DashboardOverview,
  type OverviewRange,
} from '@/lib/dashboard/overview'
import { cn } from '@/lib/utils'
import { Skeleton } from './skeleton'
import { useFormatDuration } from './use-format-duration'
import { WhatsAppHealthChip } from './whatsapp-health-chip'

const NEW_ITEMS = [
  { key: 'newContact', href: '/contacts', icon: UserPlus },
  { key: 'newDeal', href: '/pipelines', icon: Briefcase },
  { key: 'newBroadcast', href: '/broadcasts/new', icon: Radio },
  { key: 'newAutomation', href: '/automations/new', icon: Zap },
] as const

function partOfDay(date: Date): 'morning' | 'afternoon' | 'evening' {
  const h = date.getHours()
  if (h < 12) return 'morning'
  if (h < 18) return 'afternoon'
  return 'evening'
}

type SegmentStyle = 'ink' | 'highlight' | 'stripes' | 'outline'

const SEGMENT_CLASS: Record<SegmentStyle, string> = {
  ink: 'bg-ink text-ink-foreground',
  highlight: 'bg-highlight text-highlight-foreground',
  stripes: 'hatch bg-card/40 text-foreground ring-1 ring-foreground/10 ring-inset',
  outline: 'bg-card/40 text-foreground ring-1 ring-foreground/25 ring-inset',
}

interface Segment {
  label: string
  value: number | null
  style: SegmentStyle
}

/**
 * The hero strip: proportional capsules with their share printed inside,
 * echoing a progress bar split into stages.
 */
function SegmentBar({ segments }: { segments: Segment[] }) {
  const format = useFormatter()
  return (
    <div className="flex w-full items-end gap-1.5">
      {segments.map((s) => {
        const pct = s.value == null ? null : Math.round(Math.min(1, Math.max(0, s.value)) * 100)
        // Every capsule keeps a minimum width so its label stays legible.
        const grow = Math.max(pct ?? 0, 12)
        return (
          <div key={s.label} className="min-w-0" style={{ flexGrow: grow, flexBasis: 0 }}>
            <p className="mb-2 truncate pl-1 text-xs text-muted-foreground">{s.label}</p>
            <div
              className={cn(
                'flex h-11 items-center rounded-full px-4 text-xs font-medium tabular-nums transition-all',
                SEGMENT_CLASS[s.style],
              )}
            >
              {pct == null ? '—' : format.number(pct / 100, { style: 'percent', maximumFractionDigits: 0 })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function BigStat({
  icon: Icon,
  value,
  label,
}: {
  icon: ComponentType<{ className?: string }>
  value: string
  label: string
}) {
  return (
    <div className="min-w-0">
      <p className="text-5xl leading-none font-extralight tracking-tighter text-foreground tabular-nums sm:text-6xl">
        {value}
      </p>
      <p className="mt-2 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
        <span className="flex size-5 items-center justify-center rounded-full bg-card ring-1 ring-foreground/10">
          <Icon className="size-3" />
        </span>
        {label}
      </p>
    </div>
  )
}

export function OverviewHeader({
  data,
  now,
  name,
  range,
  onRangeChange,
}: {
  data: DashboardOverview | null
  now: number
  name: string | null
  range: OverviewRange
  onRangeChange: (range: OverviewRange) => void
}) {
  const t = useTranslations('Dashboard.overview.header')
  const tKpi = useTranslations('Dashboard.overview.kpi')
  const tVolume = useTranslations('Dashboard.overview.volume')
  const router = useRouter()
  const format = useFormatter()
  const formatDuration = useFormatDuration()
  const firstName = name?.trim().split(/\s+/)[0] || null

  let context: string | null = null
  let segments: Segment[] = []
  if (data) {
    const a = data.attention
    if (needsSetup(data.setup)) context = t('contextSetup')
    else if (a.waiting > 0 && a.oldestWaitingSince)
      context = t('contextWaiting', {
        count: a.waiting,
        wait: formatDuration(minutesBetween(a.oldestWaitingSince, now)),
      })
    else context = t('contextClear')

    const totalIn = data.volume.series.reduce((sum, p) => sum + p.incoming, 0)
    const totalOut = data.volume.series.reduce((sum, p) => sum + p.outgoing, 0)
    const total = totalIn + totalOut
    segments = [
      { label: tVolume('incoming'), value: total ? totalIn / total : null, style: 'ink' },
      { label: tVolume('outgoing'), value: total ? totalOut / total : null, style: 'highlight' },
      {
        label: tKpi('resolved'),
        value: ratio(data.kpis.resolved, data.kpis.newConversations),
        style: 'stripes',
      },
      {
        label: tKpi('readRate'),
        value: ratio(data.kpis.broadcastRead, data.kpis.broadcastDelivered),
        style: 'outline',
      },
    ]
  }

  return (
    <section className="animate-rise space-y-6 pt-2">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {data ? (
            <>
              <h2 className="text-4xl leading-[1.05] font-light tracking-tight text-foreground sm:text-5xl">
                {firstName
                  ? t(`greeting.${partOfDay(new Date(now))}`, { name: firstName })
                  : t(`greetingNoName.${partOfDay(new Date(now))}`)}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">{context}</p>
            </>
          ) : (
            <>
              <Skeleton className="h-12 w-80 rounded-full" />
              <Skeleton className="mt-3 h-4 w-72 rounded-full" />
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WhatsAppHealthChip />
          <Tabs value={String(range)} onValueChange={(v) => onRangeChange(Number(v) as OverviewRange)}>
            <TabsList aria-label={t('rangeLabel')}>
              {OVERVIEW_RANGES.map((r) => (
                <TabsTrigger key={r} value={String(r)} className="px-3 text-xs">
                  {t(`range.${r}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <DropdownMenu>
            <DropdownMenuTrigger className={buttonVariants({ size: 'default' })}>
              <Plus aria-hidden />
              {t('new')}
              <ChevronDown className="opacity-70" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {NEW_ITEMS.map(({ key, href, icon: Icon }) => (
                <DropdownMenuItem key={key} onClick={() => router.push(href)}>
                  <Icon aria-hidden />
                  {t(key)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:gap-12">
        <div className="min-w-0 flex-1">
          {data ? (
            <SegmentBar segments={segments} />
          ) : (
            <Skeleton className="h-[4.25rem] w-full rounded-full" />
          )}
        </div>
        <div className="grid grid-cols-3 gap-6 sm:gap-10 xl:flex xl:shrink-0">
          {data ? (
            <>
              <BigStat
                icon={MessagesSquare}
                value={format.number(data.kpis.newConversations)}
                label={tKpi('newConversations')}
              />
              <BigStat
                icon={CheckCheck}
                value={format.number(data.kpis.resolved)}
                label={tKpi('resolved')}
              />
              <BigStat
                icon={Trophy}
                value={format.number(data.kpis.dealsWon)}
                label={tKpi('dealsWon')}
              />
            </>
          ) : (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-24 rounded-2xl" />
            ))
          )}
        </div>
      </div>
    </section>
  )
}
