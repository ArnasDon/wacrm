"use client"

import { GitBranch } from 'lucide-react'
import type { PipelineSummary } from '@/lib/dashboard/types'
import { formatCurrencyTotals } from '@/lib/currency'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

import { useTranslations } from 'next-intl'

interface PipelinesOverviewProps {
  data: PipelineSummary[] | null
  loading: boolean
}

/**
 * One compact breakdown per pipeline instead of pooling every
 * pipeline's stages into a single ring — an account running more than
 * one pipeline (e.g. per market or language) needs its totals kept
 * apart, and so does every currency in play (a deal's value is only
 * ever added to other deals sharing its exact currency).
 */
export function PipelinesOverview({ data, loading }: PipelinesOverviewProps) {
  const t = useTranslations('Dashboard.pipelineDonut')

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('description')}</p>
      </header>

      <div className="flex flex-1 flex-col gap-5 p-5">
        {loading || !data ? (
          <Skeleton className="h-56 w-full" />
        ) : data.length === 0 ? (
          <EmptyState icon={GitBranch} title={t('noOpenDeals')} hint={t('noOpenDealsHint')} />
        ) : (
          data.map((pipeline) => (
            <div key={pipeline.id}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="truncate text-sm font-medium text-foreground">{pipeline.name}</h3>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                  {formatCurrencyTotals(pipeline.totalsByCurrency, { short: true })}
                </span>
              </div>
              {pipeline.stages.length === 0 ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {t('noOpenDealsForPipeline')}
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {pipeline.stages.map((s) => (
                    <li key={s.id} className="flex items-center gap-2.5 text-xs">
                      <span
                        className="h-2 w-2 flex-shrink-0 rounded-full"
                        style={{ background: s.color }}
                        aria-hidden
                      />
                      <span className="flex-1 truncate text-muted-foreground">{s.name}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {t('personCount', { count: s.peopleCount })}
                      </span>
                      <span className="w-24 shrink-0 text-right text-muted-foreground tabular-nums">
                        {formatCurrencyTotals(s.totalsByCurrency, { short: true })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  )
}
