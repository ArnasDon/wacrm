"use client"

import Link from 'next/link'
import { useState, useEffect } from 'react'
import {
  MessageSquare,
  UserPlus,
  Briefcase,
  Radio,
  Zap,
  Inbox,
} from 'lucide-react'
import type { ComponentType } from 'react'
import type { ActivityItem, ActivityKind } from '@/lib/dashboard/types'
import { cn } from '@/lib/utils'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface ActivityFeedProps {
  items: ActivityItem[] | null
  loading: boolean
}

const PAGE_SIZES = [5, 10, 20, 50] as const
type PageSize = (typeof PAGE_SIZES)[number]

interface KindTheme {
  icon: ComponentType<{ className?: string }>
  /** Tailwind classes for the round icon badge + label color. */
  badge: string
}

const KIND_THEME: Record<ActivityKind, KindTheme> = {
  message: { icon: MessageSquare, badge: 'bg-blue-500/10 text-blue-400' },
  contact: { icon: UserPlus, badge: 'bg-primary/10 text-primary' },
  deal: { icon: Briefcase, badge: 'bg-primary/10 text-primary' },
  broadcast: { icon: Radio, badge: 'bg-amber-500/10 text-amber-400' },
  automation: { icon: Zap, badge: 'bg-rose-500/10 text-rose-400' },
}

export function ActivityFeed({ items, loading }: ActivityFeedProps) {
  // Start at 5 — a quick scan of the most recent events without
  // dominating vertical real estate. User expands explicitly via the
  // footer control when they want deeper history.
  const [pageSize, setPageSize] = useState<PageSize>(5)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const totalLoaded = items?.length ?? 0
  const visible = items?.slice(0, pageSize) ?? []
  // A size option is "useful" if picking it would reveal rows the
  // smaller option doesn't already show. With PAGE_SIZES=[5,10,20,50]:
  // "10" is useful only once we've loaded ≥6 items, "20" once ≥11, etc.
  // The smallest option is always enabled.
  const isSizeUseful = (size: PageSize, i: number) =>
    i === 0 || totalLoaded > PAGE_SIZES[i - 1]

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900">
      <header className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
        <h2 className="text-sm font-semibold text-white">Atividade Recente</h2>
        <Link
          href="/inbox"
          className="text-xs font-medium text-primary hover:text-primary/80"
        >
          Ver tudo →
        </Link>
      </header>

      {loading || !items ? (
        <div className="space-y-2 p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="p-5">
          <EmptyState
            icon={Inbox}
            title="Nenhuma atividade ainda"
            hint="Atividades de mensagens, negócios, transmissões e automações aparecerão aqui."
          />
        </div>
      ) : (
        <>
          <ul className="divide-y divide-slate-800">
            {visible.map((it, i) => {
              const theme = KIND_THEME[it.kind]
              const Icon = theme.icon
              // Alternating row background for scanability — dark-theme
              // translation of the spec's white / #f9fafb stripes.
              const stripe = i % 2 === 0 ? 'bg-transparent' : 'bg-slate-900/40'
              const row = (
                <div className="flex items-center gap-3 px-5 py-2.5">
                  <span
                    className={cn(
                      'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full',
                      theme.badge,
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
                    {it.text}
                  </span>
                  <span className="flex-shrink-0 text-xs text-slate-500 tabular-nums">
                    {mounted ? relativeTime(it.at) : ''}
                  </span>
                </div>
              )
              return (
                <li key={it.id} className={cn(stripe, 'transition-colors hover:bg-slate-800/40')}>
                  {it.href ? (
                    <Link href={it.href} className="block">
                      {row}
                    </Link>
                  ) : (
                    row
                  )}
                </li>
              )
            })}
          </ul>
          <footer className="flex items-center justify-between border-t border-slate-800 px-5 py-3 text-xs">
            <span className="text-slate-500 tabular-nums">
              Mostrando {visible.length} de {totalLoaded}
              {totalLoaded === 50 ? '+' : ''}
            </span>
            <div className="flex items-center gap-1">
              <span className="mr-1 text-slate-500">Exibir</span>
              {PAGE_SIZES.map((size, i) => {
                const disabled = !isSizeUseful(size, i)
                return (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setPageSize(size)}
                    disabled={disabled}
                    className={cn(
                      'rounded-md px-2 py-1 font-medium tabular-nums transition-colors',
                      pageSize === size
                        ? 'bg-slate-700 text-white'
                        : 'text-slate-400 hover:bg-slate-800 hover:text-white',
                      disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-slate-400',
                    )}
                  >
                    {size}
                  </button>
                )
              })}
            </div>
          </footer>
        </>
      )}
    </section>
  )
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diffSec = Math.round((Date.now() - then) / 1000)
  if (diffSec < 60) return `há ${Math.max(1, diffSec)}s`
  if (diffSec < 3600) return `há ${Math.floor(diffSec / 60)}m`
  if (diffSec < 86400) return `há ${Math.floor(diffSec / 3600)}h`
  if (diffSec < 2_592_000) return `há ${Math.floor(diffSec / 86400)}d`
  return new Date(iso).toLocaleDateString('pt-BR')
}
