'use client'

import { useFormatter, useTranslations } from 'next-intl'

import { formatCurrency } from '@/lib/currency'
import {
  compare,
  ratio,
  seriesValues,
  type DashboardOverview,
} from '@/lib/dashboard/overview'
import { KpiTile, KpiTileSkeleton, TargetBar } from './kpi-tile'
import { Sparkline } from './sparkline'
import { useFormatDuration } from './use-format-duration'

export function KpiRow({
  data,
  currency,
}: {
  data: DashboardOverview | null
  currency: string
}) {
  const t = useTranslations('Dashboard.overview.kpi')
  const format = useFormatter()
  const formatDuration = useFormatDuration()

  if (!data) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <KpiTileSkeleton key={i} />
        ))}
      </div>
    )
  }

  const { kpis, replies, volume } = data
  const comparisonLabel = t(`vsPrevious.${data.days}`)
  const readRate = ratio(kpis.broadcastRead, kpis.broadcastDelivered)
  const readRatePrevious = ratio(kpis.broadcastReadPrevious, kpis.broadcastDeliveredPrevious)
  const percent = (v: number) => format.number(v, { style: 'percent', maximumFractionDigits: 0 })

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <KpiTile
        title={t('newConversations')}
        info={t('newConversationsInfo')}
        value={format.number(kpis.newConversations)}
        change={compare(kpis.newConversations, kpis.newConversationsPrevious)}
        comparisonLabel={comparisonLabel}
        footer={<Sparkline values={seriesValues(volume.series, 'newConversations')} />}
      />
      <KpiTile
        title={t('medianReply')}
        info={t('medianReplyInfo')}
        value={replies.medianHuman == null ? t('none') : formatDuration(replies.medianHuman)}
        change={compare(replies.medianHuman, replies.medianHumanPrevious, true)}
        comparisonLabel={comparisonLabel}
        footer={<TargetBar value={replies.medianHuman} target={data.replyTargetMinutes} />}
      />
      <KpiTile
        title={t('resolved')}
        info={t('resolvedInfo')}
        value={format.number(kpis.resolved)}
        change={compare(kpis.resolved, kpis.resolvedPrevious)}
        comparisonLabel={comparisonLabel}
        footer={<Sparkline values={seriesValues(volume.series, 'resolved')} />}
      />
      <KpiTile
        title={t('dealsWon')}
        info={t('dealsWonInfo')}
        value={format.number(kpis.dealsWon)}
        unit={formatCurrency(kpis.dealsWonValue, currency)}
        change={compare(kpis.dealsWon, kpis.dealsWonPrevious)}
        comparisonLabel={comparisonLabel}
        footer={<Sparkline values={seriesValues(volume.series, 'dealsWon')} />}
      />
      <KpiTile
        title={t('readRate')}
        info={t('readRateInfo')}
        value={readRate == null ? t('none') : percent(readRate)}
        change={compare(readRate, readRatePrevious)}
        comparisonLabel={comparisonLabel}
        footer={
          <p className="pt-3 text-xs text-muted-foreground tabular-nums">
            {kpis.broadcastDelivered
              ? t('readOfDelivered', {
                  read: format.number(kpis.broadcastRead),
                  delivered: format.number(kpis.broadcastDelivered),
                })
              : t('noBroadcasts')}
          </p>
        }
      />
    </div>
  )
}
